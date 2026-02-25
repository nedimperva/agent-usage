import { execFile } from "child_process";
import crypto from "crypto";
import { promises as fs } from "fs";
import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { parseDateLike, parseOptionalNumber, safeString, statusFromRemainingPercent } from "../lib/normalize";

const CURSOR_BASE_URL = "https://cursor.com";
const CURSOR_DASHBOARD_BASE_URL = "https://api2.cursor.sh";
const BROWSER_LIKE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CURSOR_SESSION_COOKIE_NAMES = new Set([
  "WorkosCursorSessionToken",
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
]);
const CURSOR_DESKTOP_AUTH_SOURCE = "auto:cursor-desktop-auth";
const CURSOR_DESKTOP_AUTH_KEYS = [
  "cursorAuth/accessToken",
  "cursorAuth/refreshToken",
  "cursorAuth/cachedEmail",
  "cursorAuth/stripeMembershipType",
  "cursorAuth/stripeSubscriptionStatus",
] as const;

interface CursorUsageSummary {
  billingCycleStart?: unknown;
  billing_cycle_start?: unknown;
  billingCycleEnd?: unknown;
  billing_cycle_end?: unknown;
  membershipType?: unknown;
  membership_type?: unknown;
  limitType?: unknown;
  limit_type?: unknown;
  isUnlimited?: unknown;
  is_unlimited?: unknown;
  autoModelSelectedDisplayMessage?: unknown;
  auto_model_selected_display_message?: unknown;
  namedModelSelectedDisplayMessage?: unknown;
  named_model_selected_display_message?: unknown;
  individualUsage?: {
    plan?: CursorMoneyUsage;
    onDemand?: CursorMoneyUsage;
    on_demand?: CursorMoneyUsage;
  };
  individual_usage?: {
    plan?: CursorMoneyUsage;
    on_demand?: CursorMoneyUsage;
  };
  teamUsage?: {
    onDemand?: CursorMoneyUsage;
    on_demand?: CursorMoneyUsage;
  };
  team_usage?: {
    on_demand?: CursorMoneyUsage;
  };
}

interface CursorMoneyUsage {
  enabled?: unknown;
  used?: unknown;
  limit?: unknown;
  remaining?: unknown;
  totalPercentUsed?: unknown;
  total_percent_used?: unknown;
}

interface CursorUserInfo {
  sub?: unknown;
  email?: unknown;
}

interface CursorLegacyUsageResponse {
  "gpt-4"?: {
    numRequests?: unknown;
    numRequestsTotal?: unknown;
    maxRequestUsage?: unknown;
  };
}

interface CursorDashboardGetMeResponse {
  authId?: unknown;
  email?: unknown;
}

interface CursorDashboardCurrentPeriodUsageResponse {
  billingCycleStart?: unknown;
  billing_cycle_start?: unknown;
  billingCycleEnd?: unknown;
  billing_cycle_end?: unknown;
  planUsage?: {
    totalSpend?: unknown;
    total_spend?: unknown;
    includedSpend?: unknown;
    included_spend?: unknown;
    bonusSpend?: unknown;
    bonus_spend?: unknown;
    remaining?: unknown;
    limit?: unknown;
    totalPercentUsed?: unknown;
    total_percent_used?: unknown;
    autoPercentUsed?: unknown;
    auto_percent_used?: unknown;
    apiPercentUsed?: unknown;
    api_percent_used?: unknown;
  };
  plan_usage?: {
    total_spend?: unknown;
    included_spend?: unknown;
    bonus_spend?: unknown;
    remaining?: unknown;
    limit?: unknown;
    total_percent_used?: unknown;
    auto_percent_used?: unknown;
    api_percent_used?: unknown;
  };
  spendLimitUsage?: {
    totalSpend?: unknown;
    total_spend?: unknown;
    pooledLimit?: unknown;
    pooled_limit?: unknown;
    pooledUsed?: unknown;
    pooled_used?: unknown;
    pooledRemaining?: unknown;
    pooled_remaining?: unknown;
    individualLimit?: unknown;
    individual_limit?: unknown;
    individualUsed?: unknown;
    individual_used?: unknown;
    individualRemaining?: unknown;
    individual_remaining?: unknown;
    limitType?: unknown;
    limit_type?: unknown;
  };
  spend_limit_usage?: {
    total_spend?: unknown;
    pooled_limit?: unknown;
    pooled_used?: unknown;
    pooled_remaining?: unknown;
    individual_limit?: unknown;
    individual_used?: unknown;
    individual_remaining?: unknown;
    limit_type?: unknown;
  };
  enabled?: unknown;
  displayMessage?: unknown;
  display_message?: unknown;
  autoModelSelectedDisplayMessage?: unknown;
  auto_model_selected_display_message?: unknown;
  namedModelSelectedDisplayMessage?: unknown;
  named_model_selected_display_message?: unknown;
}

interface CursorDashboardPlanInfoResponse {
  planInfo?: {
    planName?: unknown;
    plan_name?: unknown;
    includedAmountCents?: unknown;
    included_amount_cents?: unknown;
    billingCycleEnd?: unknown;
    billing_cycle_end?: unknown;
  };
  plan_info?: {
    plan_name?: unknown;
    included_amount_cents?: unknown;
    billing_cycle_end?: unknown;
  };
}

interface CursorDesktopAuthDiscovery {
  accessToken?: unknown;
  refreshToken?: unknown;
  cachedEmail?: unknown;
  stripeMembershipType?: unknown;
  stripeSubscriptionStatus?: unknown;
}

interface CursorDesktopDashboardSnapshot {
  summary: CursorUsageSummary;
  user?: CursorUserInfo;
  source: string;
  planLabel?: string;
  rawPayload: Record<string, unknown>;
}

interface CursorSqliteStatement {
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
}

interface CursorSqliteDatabase {
  prepare: (sql: string) => CursorSqliteStatement;
  close: () => void;
}

interface CursorSqliteModule {
  DatabaseSync: new (path: string, options?: Record<string, unknown>) => CursorSqliteDatabase;
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

const CURSOR_DESKTOP_AUTH_DISCOVERY_SCRIPT = String.raw`
import json
import os
import sqlite3

appdata = os.environ.get("APPDATA", "")
state = os.path.join(appdata, "Cursor", "User", "globalStorage", "state.vscdb")
if not os.path.exists(state):
    print("{}")
    raise SystemExit(0)

conn = sqlite3.connect(state)
cursor = conn.cursor()
rows = []
for table in ("ItemTable", "itemTable"):
    try:
        cursor.execute(
            f"SELECT key, value FROM {table} WHERE "
            "key IN ("
            "'cursorAuth/accessToken', "
            "'cursorAuth/refreshToken', "
            "'cursorAuth/cachedEmail', "
            "'cursorAuth/stripeMembershipType', "
            "'cursorAuth/stripeSubscriptionStatus') "
            "OR key LIKE 'cursorAuth/%' "
            "OR lower(key) LIKE '%cursorauth%'"
        )
        rows = cursor.fetchall()
        if rows:
            break
    except Exception:
        continue
conn.close()

result = {}
for key, value in rows:
    if key and key not in result:
        result[key] = value

print(json.dumps(result))
`;

function coerceCursorDesktopAuthValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Uint8Array) {
    const decoded = Buffer.from(value).toString("utf8").trim();
    return decoded ? decoded : undefined;
  }
  return undefined;
}

function normalizeCursorDesktopAuthKey(rawKey: string): string {
  return rawKey
    .replace(/^cursorauth\//i, "")
    .replace(/^cursorauth[:/]/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function assignCursorDesktopAuthField(
  result: CursorDesktopAuthDiscovery,
  key: string | undefined,
  value: string | undefined,
): void {
  if (!key || value === undefined) {
    return;
  }

  const normalized = normalizeCursorDesktopAuthKey(key);
  if (normalized === "accesstoken" && !result.accessToken) {
    result.accessToken = value;
    return;
  }
  if (normalized === "refreshtoken" && !result.refreshToken) {
    result.refreshToken = value;
    return;
  }
  if ((normalized === "cachedemail" || normalized === "email") && !result.cachedEmail) {
    result.cachedEmail = value;
    return;
  }
  if ((normalized === "stripemembershiptype" || normalized === "membershiptype") && !result.stripeMembershipType) {
    result.stripeMembershipType = value;
    return;
  }
  if (
    (normalized === "stripesubscriptionstatus" || normalized === "subscriptionstatus") &&
    !result.stripeSubscriptionStatus
  ) {
    result.stripeSubscriptionStatus = value;
  }
}

function parseCursorDesktopAuthJson(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed || !/^(?:\[|\{|")/.test(trimmed)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string" && parsed !== trimmed) {
      return parseCursorDesktopAuthJson(parsed) ?? parsed;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractCursorDesktopAuthFromUnknown(value: unknown, result: CursorDesktopAuthDiscovery): void {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      for (const entry of current) {
        queue.push(entry);
      }
      continue;
    }

    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      assignCursorDesktopAuthField(result, key, coerceCursorDesktopAuthValue(nested));
      if (nested && typeof nested === "object") {
        queue.push(nested);
        continue;
      }
      const nestedString = coerceCursorDesktopAuthValue(nested);
      if (!nestedString) {
        continue;
      }
      const parsedNested = parseCursorDesktopAuthJson(nestedString);
      if (parsedNested && typeof parsedNested === "object") {
        queue.push(parsedNested);
      }
    }
  }
}

export function mapCursorDesktopAuthRows(rows: Array<Record<string, unknown>>): CursorDesktopAuthDiscovery | undefined {
  const result: CursorDesktopAuthDiscovery = {};

  for (const row of rows) {
    const key = safeString(row.key);
    const value = coerceCursorDesktopAuthValue(row.value);
    assignCursorDesktopAuthField(result, key, value);

    if (!value) {
      continue;
    }

    const parsed = parseCursorDesktopAuthJson(value);
    if (parsed && typeof parsed === "object") {
      extractCursorDesktopAuthFromUnknown(parsed, result);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

async function discoverCursorDesktopAuthFromNodeSqlite(): Promise<CursorDesktopAuthDiscovery | undefined> {
  const appData = safeString(process.env.APPDATA);
  if (!appData) {
    return undefined;
  }

  const statePath = `${appData}\\Cursor\\User\\globalStorage\\state.vscdb`;
  try {
    await fs.access(statePath);
  } catch {
    return undefined;
  }

  let db: CursorSqliteDatabase | undefined;
  try {
    const sqliteModule = (await import("node:sqlite")) as unknown as CursorSqliteModule;
    db = new sqliteModule.DatabaseSync(statePath, { readonly: true });

    const placeholders = CURSOR_DESKTOP_AUTH_KEYS.map(() => "?").join(", ");
    const query = (table: string) =>
      `SELECT key, value FROM ${table} ` +
      `WHERE key IN (${placeholders}) ` +
      `OR key LIKE 'cursorAuth/%' ` +
      `OR lower(key) LIKE '%cursorauth%'`;

    for (const table of ["ItemTable", "itemTable"]) {
      try {
        const rows = db.prepare(query(table)).all(...CURSOR_DESKTOP_AUTH_KEYS);
        const parsed = mapCursorDesktopAuthRows(rows);
        if (parsed) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  } finally {
    try {
      db?.close();
    } catch {
      // noop
    }
  }

  return undefined;
}

async function discoverCursorDesktopAuth(): Promise<CursorDesktopAuthDiscovery | undefined> {
  const sqliteDiscovered = await discoverCursorDesktopAuthFromNodeSqlite();
  if (sqliteDiscovered) {
    return sqliteDiscovered;
  }

  const stdout = await runPythonScript(CURSOR_DESKTOP_AUTH_DISCOVERY_SCRIPT);
  if (!stdout) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return mapCursorDesktopAuthRows(
      Object.entries(parsed).map(([key, value]) => ({
        key,
        value,
      })),
    );
  } catch {
    return undefined;
  }
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
  if (encrypted.slice(0, 3).toString("utf8") !== "v10" && encrypted.slice(0, 3).toString("utf8") !== "v11") {
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

function hostLooksCursor(host: string | undefined): boolean {
  const lower = (host ?? "").toLowerCase();
  return lower.includes("cursor.com") || lower.includes("cursor.sh");
}

const BROWSER_COOKIE_DISCOVERY_SCRIPT = String.raw`
import base64
import glob
import json
import os
import shutil
import sqlite3
import tempfile
import urllib.parse

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

def discover_chromium():
    results = []
    v20_count = 0
    localapp = os.environ.get("LOCALAPPDATA", "")
    appdata = os.environ.get("APPDATA", "")
    browsers = [
        ("chrome", os.path.join(localapp, "Google", "Chrome", "User Data")),
        ("edge", os.path.join(localapp, "Microsoft", "Edge", "User Data")),
        ("brave", os.path.join(localapp, "BraveSoftware", "Brave-Browser", "User Data")),
    ]

    cursor_root = os.path.join(appdata, "Cursor") if appdata else ""
    if cursor_root and os.path.isdir(cursor_root):
        browsers.append(("cursor", cursor_root))

    cursor_partitions = os.path.join(cursor_root, "Partitions") if cursor_root else ""
    if cursor_partitions and os.path.isdir(cursor_partitions):
        for partition in sorted(glob.glob(os.path.join(cursor_partitions, "cursor-browser*"))):
            if os.path.isdir(partition):
                browsers.append(("cursor", partition))

    for browser, user_data in browsers:
        if not os.path.isdir(user_data):
            continue

        if browser == "cursor":
            local_state = os.path.join(cursor_root, "Local State")
            profiles = [user_data]
        else:
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
                rows = query_sqlite(
                    cookie_db,
                    "SELECT host_key, name, value, encrypted_value FROM cookies "
                    "WHERE (host_key LIKE ? OR host_key LIKE ?)",
                    ("%cursor.com%", "%cursor.sh%"),
                )
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
    for profile in glob.glob(os.path.join(profiles_root, "*")):
        cookie_db = os.path.join(profile, "cookies.sqlite")
        if not os.path.exists(cookie_db):
            continue
        rows = query_sqlite(
            cookie_db,
            "SELECT host, name, value FROM moz_cookies "
            "WHERE (host LIKE ? OR host LIKE ?)",
            ("%cursor.com%", "%cursor.sh%"),
        )
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

let lastBrowserDiscoveryHasChromiumV20 = false;
let lastBrowserDiscoveryHadLockedDatabases = false;

function buildCursorBrowserSource(browser: string, profile?: string): string {
  const profileLabel = profile
    ? (safeString(profile.split(/[\\/]/).filter(Boolean).slice(-1)[0]) ?? "profile")
    : "profile";
  return `auto:browser-${browser}-${profileLabel}`;
}

function scoreCursorCookieMap(cookieMap: Map<string, string>): number {
  let score = 0;
  for (const [name, value] of cookieMap.entries()) {
    const lower = name.toLowerCase();
    if (CURSOR_SESSION_COOKIE_NAMES.has(name)) {
      score += 25;
    }
    if (/session|token|auth|state|next[-_]?auth|workos|cursor/.test(lower)) {
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

async function discoverCursorCookieFromBrowsers(): Promise<CursorCookieCandidate[]> {
  const stdout = await runPythonScript(BROWSER_COOKIE_DISCOVERY_SCRIPT);
  if (!stdout) {
    return [];
  }

  let parsed: BrowserCookieDiscovery;
  try {
    parsed = JSON.parse(stdout.trim()) as BrowserCookieDiscovery;
  } catch {
    return [];
  }

  lastBrowserDiscoveryHasChromiumV20 =
    (parsed.diagnostics?.chromiumV20Count ?? 0) > 0 ||
    (parsed.chromium ?? []).some((row) => (row.encrypted_hex ?? "").toLowerCase().startsWith("763230"));
  lastBrowserDiscoveryHadLockedDatabases = (parsed.diagnostics?.lockedDbCount ?? 0) > 0;

  const firefoxBuckets = new Map<string, Map<string, string>>();
  for (const row of parsed.firefox ?? []) {
    const host = safeString(row.host);
    const browser = safeString(row.browser) ?? "firefox";
    const profile = safeString(row.profile);
    const name = safeString(row.name);
    const value = safeString(row.value);
    if (!hostLooksCursor(host) || !name || !value) {
      continue;
    }
    const sourceKey = `${browser}::${profile ?? "default"}`;
    if (!firefoxBuckets.has(sourceKey)) {
      firefoxBuckets.set(sourceKey, new Map<string, string>());
    }
    const map = firefoxBuckets.get(sourceKey);
    if (map && !map.has(name)) {
      map.set(name, value);
    }
  }
  const firefoxCandidates: Array<CursorCookieCandidate & { score: number }> = [];
  for (const [sourceKey, cookieMap] of firefoxBuckets.entries()) {
    const header = buildCookieHeaderFromMap(cookieMap);
    if (!header) {
      continue;
    }
    const [browser, profile] = sourceKey.split("::");
    firefoxCandidates.push({
      header,
      source: buildCursorBrowserSource(browser || "firefox", profile),
      score: scoreCursorCookieMap(cookieMap),
    });
  }

  const chromiumBuckets = new Map<string, Map<string, string>>();
  const keyCache = new Map<string, Buffer | undefined>();
  for (const row of parsed.chromium ?? []) {
    const host = safeString(row.host);
    const browser = safeString(row.browser) ?? "chromium";
    const profile = safeString(row.profile);
    const name = safeString(row.name);
    if (!hostLooksCursor(host) || !name) {
      continue;
    }
    const decrypted = await decryptChromiumCookieRecord(row, keyCache);
    if (!decrypted) {
      continue;
    }
    const sourceKey = `${browser}::${profile ?? "default"}`;
    if (!chromiumBuckets.has(sourceKey)) {
      chromiumBuckets.set(sourceKey, new Map<string, string>());
    }
    const map = chromiumBuckets.get(sourceKey);
    if (map && !map.has(name)) {
      map.set(name, decrypted);
    }
  }

  const chromiumCandidates: Array<CursorCookieCandidate & { score: number }> = [];
  for (const [sourceKey, cookieMap] of chromiumBuckets.entries()) {
    const header = buildCookieHeaderFromMap(cookieMap);
    if (!header) {
      continue;
    }
    const [browser, profile] = sourceKey.split("::");
    chromiumCandidates.push({
      header,
      source: buildCursorBrowserSource(browser || "chromium", profile),
      score: scoreCursorCookieMap(cookieMap),
    });
  }

  return [...firefoxCandidates, ...chromiumCandidates]
    .sort((a, b) => b.score - a.score)
    .map(({ header, source }) => ({ header, source }));
}

function normalizeCursorSourceMode(value: string | undefined): CursorCookieSourceMode {
  if (value?.toLowerCase() === "manual") {
    return "manual";
  }
  return "auto";
}

async function resolveCursorCookieCandidates(options: CursorFetchOptions): Promise<CursorCookieResolution> {
  const manual = options.cookieHeader?.trim();
  const cached = options.cachedCookieHeader?.trim();
  const sourceMode = normalizeCursorSourceMode(options.cookieSourceMode);
  const envCookie = process.env.CURSOR_COOKIE_HEADER?.trim() || process.env.CURSOR_COOKIE?.trim();
  const candidates: CursorCookieCandidate[] = [];
  const browserSources: string[] = [];
  const pushCandidate = (header: string | undefined, source: string) => {
    if (!header) {
      return;
    }
    const normalized = normalizeCursorCookieHeader(header);
    if (!normalized) {
      return;
    }
    if (candidates.some((candidate) => candidate.header === normalized)) {
      return;
    }
    candidates.push({ header: normalized, source });
  };

  if (sourceMode === "manual") {
    pushCandidate(manual, "manual preference");
    pushCandidate(cached, "cache");
    pushCandidate(envCookie, "environment");
    return {
      candidates,
      diagnostics: {
        sourceMode,
        manualProvided: !!manual,
        cachedProvided: !!cached,
        envProvided: !!envCookie,
        browserCandidateCount: 0,
        browserSources: [],
        browserLockedDatabases: false,
      },
    };
  }

  pushCandidate(manual, "manual preference");
  pushCandidate(cached, "cache");

  const browserCandidates = await discoverCursorCookieFromBrowsers();
  for (const browserCandidate of browserCandidates) {
    browserSources.push(browserCandidate.source);
    pushCandidate(browserCandidate.header, browserCandidate.source);
  }

  pushCandidate(envCookie, "environment");

  return {
    candidates,
    diagnostics: {
      sourceMode,
      manualProvided: !!manual,
      cachedProvided: !!cached,
      envProvided: !!envCookie,
      browserCandidateCount: browserCandidates.length,
      browserSources: Array.from(new Set(browserSources)),
      browserLockedDatabases: lastBrowserDiscoveryHadLockedDatabases,
    },
  };
}

interface CursorCookieResolutionDiagnostics {
  sourceMode: CursorCookieSourceMode;
  manualProvided: boolean;
  cachedProvided: boolean;
  envProvided: boolean;
  browserCandidateCount: number;
  browserSources: string[];
  browserLockedDatabases: boolean;
}

interface CursorCookieResolution {
  candidates: CursorCookieCandidate[];
  diagnostics: CursorCookieResolutionDiagnostics;
}

type CursorCookieSourceMode = "auto" | "manual";

interface CursorFetchOptions {
  cookieHeader?: string;
  cookieSourceMode?: CursorCookieSourceMode;
  cachedCookieHeader?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

interface CursorCookieCandidate {
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

function formatCursorCookieDiagnostics(diagnostics: CursorCookieResolutionDiagnostics): string {
  const sources =
    diagnostics.browserSources.length > 0
      ? ` (${diagnostics.browserSources.join(", ")})`
      : diagnostics.sourceMode === "manual"
        ? ""
        : " (none found)";
  return [
    `mode=${diagnostics.sourceMode}`,
    `manual=${diagnostics.manualProvided ? "set" : "empty"}`,
    `cache=${diagnostics.cachedProvided ? "set" : "empty"}`,
    diagnostics.sourceMode === "manual" ? "" : `browser=${diagnostics.browserCandidateCount}${sources}`,
    diagnostics.sourceMode === "manual" ? "" : `browserLocked=${diagnostics.browserLockedDatabases ? "yes" : "no"}`,
    `env=${diagnostics.envProvided ? "set" : "empty"}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function parseCookieLineFromMultilineInput(input: string): string | undefined {
  const lines = input.split(/\r?\n/);
  let collecting = false;
  const parts: string[] = [];

  for (const line of lines) {
    const cookieLine = line.match(/^\s*cookie\s*:\s*(.*)$/i);
    if (cookieLine) {
      collecting = true;
      if (cookieLine[1]) {
        parts.push(cookieLine[1].trim());
      }
      continue;
    }

    if (!collecting) {
      continue;
    }

    if (/^\s*[A-Za-z0-9-]+\s*:/.test(line)) {
      break;
    }

    const continuation = line.trim();
    if (!continuation) {
      break;
    }
    parts.push(continuation);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
}

function parseCookieFromCurlInput(input: string): string | undefined {
  const matches = [...input.matchAll(/(?:^|\s)(?:-H|--header)\s+(['"])(.*?)\1/gi)];
  for (const match of matches) {
    const header = match[2];
    const cookieMatch = header.match(/^\s*cookie\s*:\s*(.+)$/i);
    if (cookieMatch?.[1]) {
      return cookieMatch[1].trim();
    }
  }

  const inlineCookieMatch = input.match(/cookie:\s*([^'"\r\n]+)/i);
  if (inlineCookieMatch?.[1]) {
    return inlineCookieMatch[1].trim();
  }
  return undefined;
}

export function normalizeCursorCookieHeader(value: string): string {
  const trimmed = value.trim();
  const fromCurl = /(?:^|\s)curl\s+/i.test(trimmed) ? parseCookieFromCurlInput(trimmed) : undefined;
  const fromMultiline = trimmed.includes("\n") ? parseCookieLineFromMultilineInput(trimmed) : undefined;
  const source = fromCurl ?? fromMultiline ?? trimmed;
  const withoutPrefix = source.replace(/^cookie:\s*/i, "").replace(/^['"]|['"]$/g, "");

  return withoutPrefix
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("=") && part.length > 0)
    .join("; ");
}

function toMembershipLabel(value: unknown): string | undefined {
  const raw = safeString(value);
  if (!raw) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (normalized.includes("enterprise")) {
    return "Enterprise";
  }
  if (normalized.includes("team")) {
    return "Team";
  }
  if (normalized.includes("pro")) {
    return "Pro";
  }
  if (normalized.includes("hobby")) {
    return "Hobby";
  }

  return raw[0].toUpperCase() + raw.slice(1);
}

function formatDaysRemaining(targetIso?: string): string {
  if (!targetIso) {
    return "unknown";
  }
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) {
    return "unknown";
  }
  const deltaDays = Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
  if (deltaDays < 0) {
    return "expired";
  }
  return `${deltaDays} days`;
}

function extractPercentFromUsageMessage(value?: string): string {
  if (!value) {
    return "n/a";
  }

  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) {
    return "n/a";
  }

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }

  const rounded = Math.round(numeric * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function formatBillingDate(value?: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function toMajorUnits(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return parsed / 100;
}

function normalizeUsedPercent(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, percent));
}

function buildMoneyQuota(
  id: string,
  label: string,
  usage: CursorMoneyUsage | undefined,
  resetAt?: string,
): QuotaItem | undefined {
  if (!usage) {
    return undefined;
  }

  const used = toMajorUnits(usage.used);
  const limit = toMajorUnits(usage.limit);
  const remaining = toMajorUnits(usage.remaining);

  let remainingPercent: number | undefined;
  if (limit !== undefined && limit > 0 && remaining !== undefined) {
    remainingPercent = Math.max(0, Math.min(100, (remaining / limit) * 100));
  } else {
    const usedPercent = normalizeUsedPercent(usage.totalPercentUsed ?? usage.total_percent_used);
    if (usedPercent !== undefined) {
      remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
    }
  }

  let remainingDisplay = "Usage data available";
  if (remaining !== undefined && limit !== undefined) {
    remainingDisplay = `USD ${remaining.toFixed(2)} left of USD ${limit.toFixed(2)}`;
  } else if (used !== undefined && limit !== undefined && limit > 0) {
    const calcRemaining = Math.max(0, limit - used);
    remainingDisplay = `USD ${calcRemaining.toFixed(2)} left of USD ${limit.toFixed(2)}`;
  } else if (used !== undefined) {
    remainingDisplay = `USD ${used.toFixed(2)} used`;
  }

  return {
    id,
    label,
    remainingPercent,
    remainingDisplay,
    resetAt,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export function mapCursorUsageToQuotas(
  summary: CursorUsageSummary,
  legacyUsage?: CursorLegacyUsageResponse,
): QuotaItem[] {
  const quotas: QuotaItem[] = [];
  const resetAt = parseDateLike(summary.billingCycleEnd ?? summary.billing_cycle_end);
  const individualPlan = summary.individualUsage?.plan ?? summary.individual_usage?.plan;
  const individualOnDemand =
    summary.individualUsage?.onDemand ?? summary.individualUsage?.on_demand ?? summary.individual_usage?.on_demand;
  const teamOnDemandUsage =
    summary.teamUsage?.onDemand ?? summary.teamUsage?.on_demand ?? summary.team_usage?.on_demand;

  const included = buildMoneyQuota("cursor-plan", "Included", individualPlan, resetAt);
  const onDemand = buildMoneyQuota("cursor-on-demand", "Extra", individualOnDemand, resetAt);
  const teamOnDemand = buildMoneyQuota("cursor-team-on-demand", "Team Extra", teamOnDemandUsage, resetAt);

  if (included) {
    quotas.push(included);
  }
  if (onDemand) {
    quotas.push(onDemand);
  }
  if (teamOnDemand) {
    quotas.push(teamOnDemand);
  }

  const legacyModel = legacyUsage?.["gpt-4"];
  const maxRequests = parseOptionalNumber(legacyModel?.maxRequestUsage);
  const requestsUsed =
    parseOptionalNumber(legacyModel?.numRequestsTotal) ?? parseOptionalNumber(legacyModel?.numRequests);
  if (maxRequests !== undefined && maxRequests > 0 && requestsUsed !== undefined) {
    const remaining = Math.max(0, maxRequests - requestsUsed);
    const remainingPercent = Math.max(0, Math.min(100, (remaining / maxRequests) * 100));
    quotas.push({
      id: "cursor-legacy-requests",
      label: "Legacy Requests",
      remainingPercent,
      remainingDisplay: `${remaining.toFixed(0)} left of ${maxRequests.toFixed(0)}`,
      resetAt,
      status: statusFromRemainingPercent(remainingPercent),
    });
  }

  if (quotas.length === 0) {
    quotas.push({
      id: "cursor-empty",
      label: "Cursor Usage",
      remainingDisplay: "No usage limits found in Cursor response.",
      status: "unknown",
    });
  }

  return quotas;
}

async function requestCursorJson<T>(
  path: string,
  cookieHeader: string,
  options: { allowUnauthorized?: boolean } = {},
): Promise<T | undefined> {
  const response = await fetch(`${CURSOR_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
      Origin: "https://cursor.com",
      Referer: "https://cursor.com/dashboard",
      "User-Agent": BROWSER_LIKE_USER_AGENT,
    },
  });

  if (response.status === 401 || response.status === 403) {
    if (options.allowUnauthorized) {
      return undefined;
    }
    throw new Error("Cursor session is invalid/expired. Update Cursor Cookie Header and refresh.");
  }

  if (!response.ok) {
    if (options.allowUnauthorized) {
      return undefined;
    }
    const body = await response.text();
    throw new Error(`Cursor API ${response.status}: ${body.slice(0, 220)}`);
  }

  return (await response.json()) as T;
}

async function requestCursorDashboardJson<T>(
  path: string,
  accessToken: string,
  options: { allowUnauthorized?: boolean } = {},
): Promise<T | undefined> {
  const response = await fetch(`${CURSOR_DASHBOARD_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": BROWSER_LIKE_USER_AGENT,
    },
    body: "{}",
  });

  if (response.status === 401 || response.status === 403) {
    if (options.allowUnauthorized) {
      return undefined;
    }
    throw new Error("Cursor desktop auth token is invalid/expired. Reopen Cursor and sign in again.");
  }

  if (!response.ok) {
    if (options.allowUnauthorized) {
      return undefined;
    }
    const body = await response.text();
    throw new Error(`Cursor dashboard API ${response.status}: ${body.slice(0, 220)}`);
  }

  return (await response.json()) as T;
}

function toEpochMsNumber(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined || !Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

async function fetchCursorDesktopDashboardSnapshot(): Promise<CursorDesktopDashboardSnapshot> {
  const desktopAuth = await discoverCursorDesktopAuth();
  const accessToken = safeString(desktopAuth?.accessToken);
  if (!accessToken) {
    throw new Error("No Cursor desktop auth token found in local Cursor state.");
  }

  const usage = await requestCursorDashboardJson<CursorDashboardCurrentPeriodUsageResponse>(
    "/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
    accessToken,
  );
  if (!usage) {
    throw new Error("Cursor desktop usage response was empty.");
  }

  const me = await requestCursorDashboardJson<CursorDashboardGetMeResponse>(
    "/aiserver.v1.DashboardService/GetMe",
    accessToken,
    { allowUnauthorized: true },
  );
  const planInfo = await requestCursorDashboardJson<CursorDashboardPlanInfoResponse>(
    "/aiserver.v1.DashboardService/GetPlanInfo",
    accessToken,
    { allowUnauthorized: true },
  );

  const usagePlan = (usage.planUsage ?? usage.plan_usage) as Record<string, unknown> | undefined;
  const usageSpendLimit = (usage.spendLimitUsage ?? usage.spend_limit_usage) as Record<string, unknown> | undefined;

  const planTotalSpend = parseOptionalNumber(usagePlan?.["totalSpend"] ?? usagePlan?.["total_spend"]);
  const planLimit = parseOptionalNumber(usagePlan?.["limit"]);
  const derivedPlanRemaining =
    planLimit !== undefined && planTotalSpend !== undefined ? Math.max(0, planLimit - planTotalSpend) : undefined;
  const planRemaining = parseOptionalNumber(usagePlan?.["remaining"]) ?? derivedPlanRemaining;
  const planUsedPercent = parseOptionalNumber(usagePlan?.["totalPercentUsed"] ?? usagePlan?.["total_percent_used"]);

  const individualUsed = parseOptionalNumber(
    usageSpendLimit?.["individualUsed"] ?? usageSpendLimit?.["individual_used"],
  );
  const individualLimit = parseOptionalNumber(
    usageSpendLimit?.["individualLimit"] ?? usageSpendLimit?.["individual_limit"],
  );
  const individualRemaining =
    parseOptionalNumber(usageSpendLimit?.["individualRemaining"] ?? usageSpendLimit?.["individual_remaining"]) ??
    (individualLimit !== undefined && individualUsed !== undefined
      ? Math.max(0, individualLimit - individualUsed)
      : undefined);
  const individualPercentUsed =
    individualLimit !== undefined && individualLimit > 0 && individualUsed !== undefined
      ? (individualUsed / individualLimit) * 100
      : undefined;

  const pooledUsed = parseOptionalNumber(usageSpendLimit?.["pooledUsed"] ?? usageSpendLimit?.["pooled_used"]);
  const pooledLimit = parseOptionalNumber(usageSpendLimit?.["pooledLimit"] ?? usageSpendLimit?.["pooled_limit"]);
  const pooledRemaining =
    parseOptionalNumber(usageSpendLimit?.["pooledRemaining"] ?? usageSpendLimit?.["pooled_remaining"]) ??
    (pooledLimit !== undefined && pooledUsed !== undefined ? Math.max(0, pooledLimit - pooledUsed) : undefined);
  const pooledPercentUsed =
    pooledLimit !== undefined && pooledLimit > 0 && pooledUsed !== undefined
      ? (pooledUsed / pooledLimit) * 100
      : undefined;

  const billingCycleStart = toEpochMsNumber(usage.billingCycleStart ?? usage.billing_cycle_start);
  const billingCycleEnd =
    toEpochMsNumber(usage.billingCycleEnd ?? usage.billing_cycle_end) ??
    toEpochMsNumber(
      planInfo?.planInfo?.billingCycleEnd ??
        planInfo?.planInfo?.billing_cycle_end ??
        planInfo?.plan_info?.billing_cycle_end,
    );

  const summary: CursorUsageSummary = {
    billingCycleStart,
    billingCycleEnd,
    membershipType:
      safeString(planInfo?.planInfo?.planName ?? planInfo?.planInfo?.plan_name ?? planInfo?.plan_info?.plan_name) ??
      safeString(desktopAuth?.stripeMembershipType),
    limitType: usageSpendLimit?.["limitType"] ?? usageSpendLimit?.["limit_type"],
    autoModelSelectedDisplayMessage: usage.autoModelSelectedDisplayMessage ?? usage.auto_model_selected_display_message,
    namedModelSelectedDisplayMessage:
      usage.namedModelSelectedDisplayMessage ?? usage.named_model_selected_display_message,
    individualUsage: {
      plan: {
        used: planTotalSpend,
        limit: planLimit,
        remaining: planRemaining,
        totalPercentUsed: planUsedPercent,
      },
      onDemand: {
        used: individualUsed,
        limit: individualLimit,
        remaining: individualRemaining,
        totalPercentUsed: individualPercentUsed,
      },
    },
    teamUsage: {
      onDemand: {
        used: pooledUsed,
        limit: pooledLimit,
        remaining: pooledRemaining,
        totalPercentUsed: pooledPercentUsed,
      },
    },
  };

  const user: CursorUserInfo | undefined = me
    ? {
        sub: me.authId,
        email: me.email ?? desktopAuth?.cachedEmail,
      }
    : desktopAuth?.cachedEmail
      ? {
          email: desktopAuth.cachedEmail,
        }
      : undefined;

  const planLabel =
    safeString(planInfo?.planInfo?.planName ?? planInfo?.planInfo?.plan_name ?? planInfo?.plan_info?.plan_name) ??
    safeString(desktopAuth?.stripeMembershipType);

  return {
    summary,
    user,
    source: CURSOR_DESKTOP_AUTH_SOURCE,
    planLabel,
    rawPayload: {
      usage,
      me,
      planInfo,
      membershipType: desktopAuth?.stripeMembershipType,
      subscriptionStatus: desktopAuth?.stripeSubscriptionStatus,
    },
  };
}

export async function fetchCursorSnapshot(input?: string | CursorFetchOptions): Promise<ProviderUsageSnapshot> {
  const options: CursorFetchOptions = typeof input === "string" ? { cookieHeader: input } : (input ?? {});
  const sourceMode = normalizeCursorSourceMode(options.cookieSourceMode);
  const resolution = await resolveCursorCookieCandidates(options);
  const candidates = resolution.candidates;
  const diagnosticsText = formatCursorCookieDiagnostics(resolution.diagnostics);

  let summary: CursorUsageSummary | undefined;
  let user: CursorUserInfo | undefined;
  let legacyUsage: CursorLegacyUsageResponse | undefined;
  let selectedCookie: CursorCookieCandidate | undefined;
  let selectedAuthSource: string | undefined;
  let dashboardRawPayload: Record<string, unknown> | undefined;
  let planLabelOverride: string | undefined;
  let lastError: Error | undefined;
  let desktopFallbackError: Error | undefined;
  const attemptedSources: string[] = [];

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      attemptedSources.push(candidate.source);
      try {
        const currentSummary = await requestCursorJson<CursorUsageSummary>("/api/usage-summary", candidate.header);
        if (!currentSummary) {
          continue;
        }

        const currentUser = await requestCursorJson<CursorUserInfo>("/api/auth/me", candidate.header, {
          allowUnauthorized: true,
        });
        const userIdForLegacy = safeString(currentUser?.sub);
        const currentLegacyUsage = userIdForLegacy
          ? await requestCursorJson<CursorLegacyUsageResponse>(
              `/api/usage?user=${encodeURIComponent(userIdForLegacy)}`,
              candidate.header,
              {
                allowUnauthorized: true,
              },
            )
          : undefined;

        summary = currentSummary;
        user = currentUser;
        legacyUsage = currentLegacyUsage;
        selectedCookie = candidate;
        selectedAuthSource = candidate.source;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
    }
  }

  if (!summary && sourceMode === "auto") {
    attemptedSources.push(CURSOR_DESKTOP_AUTH_SOURCE);
    try {
      const desktopSnapshot = await fetchCursorDesktopDashboardSnapshot();
      summary = desktopSnapshot.summary;
      user = desktopSnapshot.user;
      legacyUsage = undefined;
      selectedAuthSource = desktopSnapshot.source;
      dashboardRawPayload = desktopSnapshot.rawPayload;
      planLabelOverride = desktopSnapshot.planLabel;
    } catch (error) {
      desktopFallbackError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!summary) {
    if (candidates.length === 0 && sourceMode === "manual") {
      throw new Error(
        `Cursor Cookie Source is manual, but no valid Cursor Cookie Header is configured (${diagnosticsText}).`,
      );
    }
    if (candidates.length === 0 && resolution.diagnostics.browserLockedDatabases) {
      throw new Error(
        `No Cursor cookie session found. Cursor browser cookie databases appear locked by a running process. Close Cursor completely once, then refresh (${diagnosticsText}).`,
      );
    }
    if (candidates.length === 0 && lastBrowserDiscoveryHasChromiumV20) {
      throw new Error(
        `Cursor browser cookies are Chrome app-bound (\`v20\`) and cannot be auto-read here. Use Manual mode and paste a Cookie header from cursor.com (${diagnosticsText}).`,
      );
    }
    const attempted = attemptedSources.length > 0 ? ` Tried sources: ${attemptedSources.join(", ")}.` : "";
    const reason = lastError?.message ?? "Cursor cookie/auth is invalid or unavailable.";
    const desktopReason = desktopFallbackError ? ` Desktop fallback: ${desktopFallbackError.message}.` : "";
    const v20Hint =
      lastBrowserDiscoveryHasChromiumV20 && sourceMode === "auto"
        ? " Browser cookies appear app-bound (`v20`); use Manual mode with a copied Cookie header."
        : "";
    throw new Error(`${reason}${attempted} Checked: ${diagnosticsText}.${desktopReason}${v20Hint}`);
  }

  if (selectedCookie && options.onCookieResolved) {
    await options.onCookieResolved(selectedCookie.header, selectedCookie.source);
  }

  const quotas = mapCursorUsageToQuotas(summary, legacyUsage);
  const planLabel =
    toMembershipLabel(planLabelOverride ?? summary.membershipType ?? summary.membership_type) ?? "Session";
  const email = safeString(user?.email);
  const billingStart = parseDateLike(summary.billingCycleStart ?? summary.billing_cycle_start);
  const billingEnd = parseDateLike(summary.billingCycleEnd ?? summary.billing_cycle_end);
  const billingStartDisplay = formatBillingDate(billingStart);
  const billingEndDisplay = formatBillingDate(billingEnd);
  const autoMessage = safeString(
    summary.autoModelSelectedDisplayMessage ?? summary.auto_model_selected_display_message,
  );
  const namedMessage = safeString(
    summary.namedModelSelectedDisplayMessage ?? summary.named_model_selected_display_message,
  );
  const autoPercent = extractPercentFromUsageMessage(autoMessage);
  const namedPercent = extractPercentFromUsageMessage(namedMessage);
  const limitType = safeString(summary.limitType ?? summary.limit_type);
  const isUnlimited = summary.isUnlimited === true || summary.is_unlimited === true;
  const highlights = [`Auto: ${autoPercent}`, `Named: ${namedPercent}`].filter((entry): entry is string => !!entry);

  return {
    provider: "cursor",
    planLabel: email ? `${planLabel} (${email})` : planLabel,
    fetchedAt: new Date().toISOString(),
    quotas,
    highlights,
    source: "api",
    metadataSections: [
      {
        id: "billing",
        title: "Billing",
        items: [
          { label: "Cycle start", value: billingStartDisplay || "unknown" },
          { label: "Cycle end", value: billingEndDisplay || "unknown" },
          { label: "Days remaining", value: formatDaysRemaining(billingEnd) },
          { label: "Reset policy", value: "Billing cycle end from usage-summary" },
        ],
      },
      {
        id: "policy",
        title: "Policy",
        items: [
          { label: "Limit type", value: limitType ?? "unknown" },
          { label: "Unlimited", value: isUnlimited ? "yes" : "no" },
        ],
      },
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Auth mode", value: sourceMode },
          { label: "Auth source", value: selectedAuthSource ?? "unknown" },
          { label: "Auto model usage", value: autoMessage ?? "n/a" },
          { label: "Named model usage", value: namedMessage ?? "n/a" },
        ],
      },
    ],
    rawPayload: {
      summary,
      user,
      legacyUsage,
      authSource: selectedAuthSource,
      cookieSource: selectedCookie?.source,
      dashboard: dashboardRawPayload,
    },
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Monthly reset at Cursor billing cycle end.",
  };
}
