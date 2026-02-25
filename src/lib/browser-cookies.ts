import { execFile } from "child_process";
import crypto from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";

export interface BrowserCookieCandidate {
  header: string;
  source: string;
}

interface ChromiumCookieRecord {
  browser: string;
  profile?: string;
  local_state: string;
  host: string;
  name: string;
  value?: string;
  encrypted_hex?: string;
}

interface FirefoxCookieRecord {
  browser?: string;
  profile?: string;
  host: string;
  name: string;
  value: string;
}

interface BrowserCookieDiscovery {
  chromium?: ChromiumCookieRecord[];
  firefox?: FirefoxCookieRecord[];
  diagnostics?: {
    chromiumV20Count?: number;
    lockedDbCount?: number;
    copyFailureCount?: number;
    readOnlyFailureCount?: number;
  };
}

interface SqliteStatement {
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
}

interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: Record<string, unknown>) => SqliteDatabase;
}

interface ChromiumBrowserConfig {
  name: string;
  root: string;
  mode: "profiles" | "single";
  localState?: string;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function pathExists(target: string | undefined): Promise<boolean> {
  if (!target) {
    return false;
  }
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runCommand(binary: string, args: string[], timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).toString().trim()));
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

async function runPythonScript(script: string): Promise<string | undefined> {
  const attempts: Array<{ binary: string; args: string[] }> = [
    { binary: "python", args: ["-c", script] },
    { binary: "py", args: ["-3", "-c", script] },
    { binary: "python3", args: ["-c", script] },
  ];
  for (const attempt of attempts) {
    try {
      return await runCommand(attempt.binary, attempt.args, 15000);
    } catch {
      continue;
    }
  }
  return undefined;
}

async function dpapiUnprotect(value: Buffer): Promise<Buffer | undefined> {
  if (value.length === 0) {
    return undefined;
  }

  const input = value.toString("base64");
  const command =
    `$in='${input}'; ` +
    "$bytes=[Convert]::FromBase64String($in); " +
    "$out=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
    "[Convert]::ToBase64String($out)";
  try {
    const output = await runCommand("powershell", ["-NoProfile", "-Command", command], 8000);
    const normalized = output.trim();
    if (!normalized) {
      return undefined;
    }
    return Buffer.from(normalized, "base64");
  } catch {
    return undefined;
  }
}

async function chromiumMasterKey(localStatePath: string): Promise<Buffer | undefined> {
  try {
    const raw = await fs.readFile(localStatePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const osCrypt = parsed.os_crypt;
    if (!osCrypt || typeof osCrypt !== "object") {
      return undefined;
    }
    const encryptedKeyB64 = safeString((osCrypt as Record<string, unknown>).encrypted_key);
    if (!encryptedKeyB64) {
      return undefined;
    }
    let encryptedKey = Buffer.from(encryptedKeyB64, "base64");
    if (encryptedKey.slice(0, 5).toString("utf8") === "DPAPI") {
      encryptedKey = encryptedKey.slice(5);
    }
    return await dpapiUnprotect(encryptedKey);
  } catch {
    return undefined;
  }
}

function decryptChromiumCookieWithAesGcm(encrypted: Buffer, key: Buffer): string | undefined {
  if (encrypted.length < 3 + 12 + 16) {
    return undefined;
  }
  const version = encrypted.slice(0, 3).toString("utf8");
  if (version !== "v10" && version !== "v11") {
    return undefined;
  }

  const nonce = encrypted.slice(3, 15);
  const ciphertextTag = encrypted.slice(15);
  if (ciphertextTag.length <= 16) {
    return undefined;
  }
  const ciphertext = ciphertextTag.slice(0, -16);
  const tag = ciphertextTag.slice(-16);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return undefined;
  }
}

async function decryptChromiumCookieRecord(
  record: ChromiumCookieRecord,
  keyCache: Map<string, Buffer | undefined>,
): Promise<string | undefined> {
  const direct = safeString(record.value);
  if (direct) {
    return direct;
  }

  const encryptedHex = safeString(record.encrypted_hex);
  if (!encryptedHex) {
    return undefined;
  }
  const encrypted = Buffer.from(encryptedHex, "hex");
  if (encrypted.length === 0) {
    return undefined;
  }

  const versionPrefix = encrypted.slice(0, 3).toString("utf8");
  if (versionPrefix === "v10" || versionPrefix === "v11") {
    const localStatePath = safeString(record.local_state);
    if (!localStatePath) {
      return undefined;
    }
    if (!keyCache.has(localStatePath)) {
      keyCache.set(localStatePath, await chromiumMasterKey(localStatePath));
    }
    const key = keyCache.get(localStatePath);
    if (!key) {
      return undefined;
    }
    return decryptChromiumCookieWithAesGcm(encrypted, key);
  }

  const unprotected = await dpapiUnprotect(encrypted);
  return unprotected?.toString("utf8");
}

function buildCookieHeaderFromMap(cookieMap: Map<string, string>): string | undefined {
  const entries = Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .filter((entry) => entry.includes("=") && entry.length > 2);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.join("; ");
}

function buildBrowserCookieDiscoveryScript(domains: string[]): string {
  const patterns = JSON.stringify(domains.map((domain) => `%${domain.toLowerCase()}%`));
  return String.raw`
import glob
import json
import os
import shutil
import sqlite3
import tempfile
import urllib.parse

patterns = ${patterns}
LOCK_ERROR_SUBSTRINGS = [
    "used by another process",
    "cannot access the file",
    "permission denied",
    "sharing violation",
]
query_diagnostics = {
    "lockedCount": 0,
    "copyFailures": 0,
    "readOnlyFailures": 0,
}

def _looks_locked_error(exc):
    text = str(exc).lower()
    return any(token in text for token in LOCK_ERROR_SUBSTRINGS)

def query_sqlite(path, query, params):
    def _query_from_connection(conn):
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return rows

    def _query_read_only():
        escaped = urllib.parse.quote(path.replace("\\", "/"), safe="/:")
        uri = f"file:{escaped}?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True)
        return _query_from_connection(conn)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite")
    tmp.close()
    try:
        shutil.copy2(path, tmp.name)
        conn = sqlite3.connect(tmp.name)
        return _query_from_connection(conn)
    except Exception as exc:
        query_diagnostics["copyFailures"] += 1
        if _looks_locked_error(exc):
            query_diagnostics["lockedCount"] += 1
        try:
            return _query_read_only()
        except Exception as inner_exc:
            query_diagnostics["readOnlyFailures"] += 1
            if _looks_locked_error(inner_exc):
                query_diagnostics["lockedCount"] += 1
            return []
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass

def build_where(column):
    if not patterns:
        return "1=0"
    return " OR ".join([f"{column} LIKE ?" for _ in patterns])

def discover_chromium():
    results = []
    v20_count = 0
    localapp = os.environ.get("LOCALAPPDATA", "")
    appdata = os.environ.get("APPDATA", "")
    browsers = [
        {"name": "chrome", "root": os.path.join(localapp, "Google", "Chrome", "User Data"), "mode": "profiles"},
        {"name": "edge", "root": os.path.join(localapp, "Microsoft", "Edge", "User Data"), "mode": "profiles"},
        {"name": "brave", "root": os.path.join(localapp, "BraveSoftware", "Brave-Browser", "User Data"), "mode": "profiles"},
        {"name": "arc", "root": os.path.join(localapp, "Arc", "User Data"), "mode": "profiles"},
        {"name": "vivaldi", "root": os.path.join(localapp, "Vivaldi", "User Data"), "mode": "profiles"},
        {"name": "opera", "root": os.path.join(appdata, "Opera Software", "Opera Stable"), "mode": "single"},
        {"name": "opera-gx", "root": os.path.join(appdata, "Opera Software", "Opera GX Stable"), "mode": "single"},
    ]

    cursor_root = os.path.join(appdata, "Cursor") if appdata else ""
    if cursor_root and os.path.isdir(cursor_root):
        browsers.append({
            "name": "cursor",
            "root": cursor_root,
            "mode": "single",
            "local_state": os.path.join(cursor_root, "Local State"),
        })

    cursor_partitions = os.path.join(cursor_root, "Partitions") if cursor_root else ""
    if cursor_partitions and os.path.isdir(cursor_partitions):
        for partition in sorted(glob.glob(os.path.join(cursor_partitions, "cursor-browser*"))):
            if os.path.isdir(partition):
                browsers.append({
                    "name": "cursor",
                    "root": partition,
                    "mode": "single",
                    "local_state": os.path.join(cursor_root, "Local State"),
                })

    where_clause = build_where("host_key")
    query = "SELECT host_key, name, value, encrypted_value FROM cookies WHERE (" + where_clause + ")"
    for config in browsers:
        browser = config.get("name")
        user_data = config.get("root")
        mode = config.get("mode")
        if not user_data or not os.path.isdir(user_data):
            continue

        local_state = config.get("local_state") or os.path.join(user_data, "Local State")
        if mode == "single":
            profiles = [user_data]
        else:
            profile_globs = [os.path.join(user_data, "Default"), os.path.join(user_data, "Profile *")]
            profiles = []
            for pattern in profile_globs:
                profiles.extend(glob.glob(pattern))
            if not profiles:
                profiles = [user_data]

        for profile in profiles:
            candidates = [
                os.path.join(profile, "Network", "Cookies"),
                os.path.join(profile, "Cookies"),
            ]
            for cookie_db in candidates:
                if not os.path.exists(cookie_db):
                    continue
                rows = query_sqlite(cookie_db, query, tuple(patterns))
                for row in rows:
                    encrypted = row["encrypted_value"] or b""
                    if isinstance(encrypted, (bytes, bytearray)) and encrypted.startswith(b"v20"):
                        v20_count += 1
                    encrypted_hex = encrypted.hex() if isinstance(encrypted, (bytes, bytearray)) else ""
                    results.append({
                        "browser": browser,
                        "profile": profile,
                        "local_state": local_state,
                        "host": row["host_key"],
                        "name": row["name"],
                        "value": row["value"] or "",
                        "encrypted_hex": encrypted_hex,
                    })
                break
    return results, v20_count

def discover_firefox():
    results = []
    appdata = os.environ.get("APPDATA", "")
    profiles_root = os.path.join(appdata, "Mozilla", "Firefox", "Profiles")
    if not os.path.isdir(profiles_root):
        return results
    where_clause = build_where("host")
    query = "SELECT host, name, value FROM moz_cookies WHERE (" + where_clause + ")"
    for profile in glob.glob(os.path.join(profiles_root, "*")):
        cookie_db = os.path.join(profile, "cookies.sqlite")
        if not os.path.exists(cookie_db):
            continue
        rows = query_sqlite(cookie_db, query, tuple(patterns))
        for row in rows:
            results.append({
                "browser": "firefox",
                "profile": profile,
                "host": row["host"],
                "name": row["name"],
                "value": row["value"] or "",
            })
    return results

chromium_rows, chromium_v20_count = discover_chromium()
print(json.dumps({
    "chromium": chromium_rows,
    "firefox": discover_firefox(),
    "diagnostics": {
        "chromiumV20Count": chromium_v20_count,
        "lockedDbCount": query_diagnostics["lockedCount"],
        "copyFailureCount": query_diagnostics["copyFailures"],
        "readOnlyFailureCount": query_diagnostics["readOnlyFailures"],
    },
}))
`;
}

function buildSourceLabel(browser: string, profile?: string): string {
  const profileLabel = profile ? profile.split(/[\\/]/).filter(Boolean).slice(-1)[0] || "profile" : "profile";
  return `auto:browser-${browser}-${profileLabel}`;
}

function domainLikePatterns(domains: string[]): string[] {
  return domains.map((domain) => `%${domain.toLowerCase()}%`);
}

function chromiumBrowserConfigsFromEnv(): ChromiumBrowserConfig[] {
  const localApp = safeString(process.env.LOCALAPPDATA) ?? "";
  const appData = safeString(process.env.APPDATA) ?? "";
  const configs: ChromiumBrowserConfig[] = [
    { name: "chrome", root: path.join(localApp, "Google", "Chrome", "User Data"), mode: "profiles" },
    { name: "chrome-beta", root: path.join(localApp, "Google", "Chrome Beta", "User Data"), mode: "profiles" },
    { name: "chrome-canary", root: path.join(localApp, "Google", "Chrome SxS", "User Data"), mode: "profiles" },
    { name: "edge", root: path.join(localApp, "Microsoft", "Edge", "User Data"), mode: "profiles" },
    { name: "edge-beta", root: path.join(localApp, "Microsoft", "Edge Beta", "User Data"), mode: "profiles" },
    { name: "edge-dev", root: path.join(localApp, "Microsoft", "Edge Dev", "User Data"), mode: "profiles" },
    { name: "edge-canary", root: path.join(localApp, "Microsoft", "Edge SxS", "User Data"), mode: "profiles" },
    { name: "brave", root: path.join(localApp, "BraveSoftware", "Brave-Browser", "User Data"), mode: "profiles" },
    { name: "arc", root: path.join(localApp, "Arc", "User Data"), mode: "profiles" },
    { name: "vivaldi", root: path.join(localApp, "Vivaldi", "User Data"), mode: "profiles" },
    { name: "opera", root: path.join(appData, "Opera Software", "Opera Stable"), mode: "single" },
    { name: "opera-gx", root: path.join(appData, "Opera Software", "Opera GX Stable"), mode: "single" },
  ];

  const cursorRoot = appData ? path.join(appData, "Cursor") : "";
  if (cursorRoot) {
    configs.push({
      name: "cursor",
      root: cursorRoot,
      mode: "single",
      localState: path.join(cursorRoot, "Local State"),
    });
  }

  return configs;
}

async function resolveChromiumProfiles(root: string, mode: "profiles" | "single"): Promise<string[]> {
  if (mode === "single") {
    return [root];
  }

  const profiles = new Set<string>([path.join(root, "Default")]);
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const name = entry.name;
      if (
        /^Profile\s+\d+$/i.test(name) ||
        /^Profile\s+.+$/i.test(name) ||
        /^Guest Profile$/i.test(name) ||
        /^Person \d+$/i.test(name)
      ) {
        profiles.add(path.join(root, name));
      }
    }
  } catch {
    // Best effort.
  }

  const resolved: string[] = [];
  for (const profile of profiles) {
    const cookiePath = path.join(profile, "Cookies");
    const networkCookiePath = path.join(profile, "Network", "Cookies");
    if ((await pathExists(networkCookiePath)) || (await pathExists(cookiePath))) {
      resolved.push(profile);
    }
  }

  if (resolved.length === 0) {
    return [root];
  }

  return resolved;
}

async function querySqliteWithNode(
  dbPath: string,
  sql: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  let sqliteModule: SqliteModule;
  try {
    sqliteModule = (await import("node:sqlite")) as unknown as SqliteModule;
  } catch {
    return [];
  }

  const runQuery = (targetPath: string): Array<Record<string, unknown>> => {
    const db = new sqliteModule.DatabaseSync(targetPath, { readonly: true });
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  };

  try {
    return runQuery(dbPath);
  } catch {
    const tempPath = path.join(tmpdir(), `agent-usage-cookie-${crypto.randomUUID()}.sqlite`);
    try {
      await fs.copyFile(dbPath, tempPath);
      return runQuery(tempPath);
    } catch {
      return [];
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch {
        // noop
      }
    }
  }
}

async function discoverBrowserCookiesWithNodeSqlite(domains: string[]): Promise<BrowserCookieDiscovery | undefined> {
  const patterns = domainLikePatterns(domains);
  if (patterns.length === 0) {
    return {
      chromium: [],
      firefox: [],
      diagnostics: { chromiumV20Count: 0 },
    };
  }

  const chromium: ChromiumCookieRecord[] = [];
  const firefox: FirefoxCookieRecord[] = [];
  let chromiumV20Count = 0;

  const chromiumWhere = patterns.map(() => "host_key LIKE ?").join(" OR ");
  const chromiumSql =
    "SELECT host_key, name, value, hex(encrypted_value) AS encrypted_hex " + `FROM cookies WHERE (${chromiumWhere})`;

  for (const config of chromiumBrowserConfigsFromEnv()) {
    if (!(await pathExists(config.root))) {
      continue;
    }

    const profiles = await resolveChromiumProfiles(config.root, config.mode);
    const localState = config.localState ?? path.join(config.root, "Local State");
    for (const profile of profiles) {
      const candidates = [path.join(profile, "Network", "Cookies"), path.join(profile, "Cookies")];
      for (const cookieDb of candidates) {
        if (!(await pathExists(cookieDb))) {
          continue;
        }

        const rows = await querySqliteWithNode(cookieDb, chromiumSql, patterns);
        for (const row of rows) {
          const encryptedHex = safeString(row.encrypted_hex) ?? "";
          if (encryptedHex.toLowerCase().startsWith("763230")) {
            chromiumV20Count += 1;
          }
          chromium.push({
            browser: config.name,
            profile,
            local_state: localState,
            host: safeString(row.host_key) ?? "",
            name: safeString(row.name) ?? "",
            value: safeString(row.value),
            encrypted_hex: encryptedHex,
          });
        }
        break;
      }
    }
  }

  const appData = safeString(process.env.APPDATA);
  if (appData) {
    const firefoxProfiles = path.join(appData, "Mozilla", "Firefox", "Profiles");
    if (await pathExists(firefoxProfiles)) {
      const firefoxWhere = patterns.map(() => "host LIKE ?").join(" OR ");
      const firefoxSql = `SELECT host, name, value FROM moz_cookies WHERE (${firefoxWhere})`;
      try {
        const entries = await fs.readdir(firefoxProfiles, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const profile = path.join(firefoxProfiles, entry.name);
          const cookieDb = path.join(profile, "cookies.sqlite");
          if (!(await pathExists(cookieDb))) {
            continue;
          }
          const rows = await querySqliteWithNode(cookieDb, firefoxSql, patterns);
          for (const row of rows) {
            firefox.push({
              browser: "firefox",
              profile,
              host: safeString(row.host) ?? "",
              name: safeString(row.name) ?? "",
              value: safeString(row.value) ?? "",
            });
          }
        }
      } catch {
        // Best effort.
      }
    }
  }

  return {
    chromium,
    firefox,
    diagnostics: {
      chromiumV20Count,
    },
  };
}

function scoreCookieMap(cookieMap: Map<string, string>, requiredCookieNames: string[] | undefined): number {
  let score = 0;
  const requiredSet = new Set(requiredCookieNames ?? []);
  for (const [name, value] of cookieMap.entries()) {
    const lower = name.toLowerCase();
    if (requiredSet.has(name)) {
      score += 25;
    }
    if (/session|token|auth|state|next[-_]?auth|workos|access|refresh/.test(lower)) {
      score += 6;
    }
    if (/cf_clearance|cf_bm|posthog|anonymous|htjs|_dd_s/.test(lower)) {
      score -= 3;
    }
    if (value.length > 20) {
      score += 1;
    }
  }
  return score;
}

export async function discoverBrowserCookieCandidates(
  domains: string[],
  options: { requiredCookieNames?: string[] } = {},
): Promise<{ candidates: BrowserCookieCandidate[]; hasChromiumV20: boolean }> {
  const normalizedDomains = domains.map((domain) => domain.trim().toLowerCase()).filter((domain) => !!domain);
  if (normalizedDomains.length === 0) {
    return { candidates: [], hasChromiumV20: false };
  }

  const script = buildBrowserCookieDiscoveryScript(normalizedDomains);
  const stdout = await runPythonScript(script);
  let parsed: BrowserCookieDiscovery | undefined;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout.trim()) as BrowserCookieDiscovery;
    } catch {
      parsed = undefined;
    }
  }
  if (!parsed) {
    parsed = await discoverBrowserCookiesWithNodeSqlite(normalizedDomains);
  }
  if (!parsed) {
    return { candidates: [], hasChromiumV20: false };
  }

  const hasChromiumV20 =
    (parsed.diagnostics?.chromiumV20Count ?? 0) > 0 ||
    (parsed.chromium ?? []).some((row) => (row.encrypted_hex ?? "").toLowerCase().startsWith("763230"));

  const bucketMaps = new Map<string, Map<string, string>>();
  const pushCookie = (sourceKey: string, name?: string, value?: string) => {
    if (!name || !value) {
      return;
    }
    if (!bucketMaps.has(sourceKey)) {
      bucketMaps.set(sourceKey, new Map<string, string>());
    }
    const map = bucketMaps.get(sourceKey);
    if (map && !map.has(name)) {
      map.set(name, value);
    }
  };

  for (const row of parsed.firefox ?? []) {
    const browser = safeString(row.browser) ?? "firefox";
    const profile = safeString(row.profile);
    pushCookie(`${browser}::${profile ?? "default"}`, safeString(row.name), safeString(row.value));
  }

  const keyCache = new Map<string, Buffer | undefined>();
  for (const row of parsed.chromium ?? []) {
    const browser = safeString(row.browser) ?? "chromium";
    const profile = safeString(row.profile);
    const name = safeString(row.name);
    if (!name) {
      continue;
    }
    const decrypted = await decryptChromiumCookieRecord(row, keyCache);
    if (!decrypted) {
      continue;
    }
    pushCookie(`${browser}::${profile ?? "default"}`, name, decrypted);
  }

  const candidates = Array.from(bucketMaps.entries())
    .map(([sourceKey, cookieMap]) => {
      const header = buildCookieHeaderFromMap(cookieMap);
      if (!header) {
        return undefined;
      }
      const [browser, profile] = sourceKey.split("::");
      return {
        header,
        source: buildSourceLabel(browser || "browser", profile),
        score: scoreCookieMap(cookieMap, options.requiredCookieNames),
      };
    })
    .filter((candidate): candidate is BrowserCookieCandidate & { score: number } => !!candidate)
    .sort((a, b) => b.score - a.score)
    .map(({ header, source }) => ({ header, source }));

  return {
    candidates,
    hasChromiumV20,
  };
}
