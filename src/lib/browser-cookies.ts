import { execFile } from "child_process";
import crypto from "crypto";
import { promises as fs } from "fs";

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
  };
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

patterns = ${patterns}

def query_sqlite(path, query, params):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite")
    tmp.close()
    try:
        shutil.copy2(path, tmp.name)
        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return rows
    except Exception:
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
    browsers = [
        ("chrome", os.path.join(localapp, "Google", "Chrome", "User Data")),
        ("edge", os.path.join(localapp, "Microsoft", "Edge", "User Data")),
        ("brave", os.path.join(localapp, "BraveSoftware", "Brave-Browser", "User Data")),
    ]
    where_clause = build_where("host_key")
    query = "SELECT host_key, name, value, encrypted_value FROM cookies WHERE (" + where_clause + ")"
    for browser, user_data in browsers:
        if not os.path.isdir(user_data):
            continue
        local_state = os.path.join(user_data, "Local State")
        profile_globs = [os.path.join(user_data, "Default"), os.path.join(user_data, "Profile *")]
        profiles = []
        for pattern in profile_globs:
            profiles.extend(glob.glob(pattern))
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
    },
}))
`;
}

function buildSourceLabel(browser: string, profile?: string): string {
  const profileLabel = profile ? profile.split(/[\\/]/).filter(Boolean).slice(-1)[0] || "profile" : "profile";
  return `auto:browser-${browser}-${profileLabel}`;
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
  if (!stdout) {
    return { candidates: [], hasChromiumV20: false };
  }

  let parsed: BrowserCookieDiscovery;
  try {
    parsed = JSON.parse(stdout.trim()) as BrowserCookieDiscovery;
  } catch {
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
