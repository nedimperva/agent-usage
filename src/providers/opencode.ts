import { ProviderUsageSnapshot } from "../models/usage";
import { parseDateLike, parseOptionalNumber, statusFromRemainingPercent } from "../lib/normalize";

const OPENCODE_SERVER_URL = "https://opencode.ai/_server";
const OPENCODE_WORKSPACES_SERVER_ID = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";
const OPENCODE_SUBSCRIPTION_SERVER_ID = "7abeebee372f304e050aaaf92be863f4a86490e382f8c79db68fd94040d691b4";
const OPENCODE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const OPENCODE_PERCENT_KEYS = [
  "usagePercent",
  "usedPercent",
  "percentUsed",
  "percent",
  "usage_percent",
  "used_percent",
  "utilization",
  "utilizationPercent",
  "utilization_percent",
];
const OPENCODE_RESET_IN_KEYS = [
  "resetInSec",
  "resetInSeconds",
  "resetSeconds",
  "reset_sec",
  "reset_in_sec",
  "resetsInSec",
  "resetsInSeconds",
  "resetIn",
  "resetSec",
];
const OPENCODE_RESET_AT_KEYS = [
  "resetAt",
  "resetsAt",
  "reset_at",
  "resets_at",
  "nextReset",
  "next_reset",
  "renewAt",
  "renew_at",
];
const OPENCODE_USED_KEYS = ["used", "usage", "consumed", "count", "usedTokens"];
const OPENCODE_LIMIT_KEYS = ["limit", "total", "quota", "max", "cap", "tokenLimit"];

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

  return parts.length > 0 ? parts.join(" ") : undefined;
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
  return undefined;
}

function normalizeCookieHeader(value: string): string {
  const trimmed = value.trim();
  const fromCurl = /(?:^|\s)curl\s+/i.test(trimmed) ? parseCookieFromCurlInput(trimmed) : undefined;
  const fromMultiline = trimmed.includes("\n") ? parseCookieLineFromMultilineInput(trimmed) : undefined;
  const source = fromCurl ?? fromMultiline ?? trimmed;
  const withoutPrefix = source.replace(/^cookie:\s*/i, "").replace(/^['"]|['"]$/g, "");
  return withoutPrefix
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .join("; ");
}

function resolveCookieHeader(manualCookieHeader?: string): { header: string; source: string } {
  const candidates = [
    { value: manualCookieHeader, source: "manual preference" },
    { value: process.env.OPENCODE_COOKIE_HEADER, source: "environment OPENCODE_COOKIE_HEADER" },
    { value: process.env.OPENCODE_COOKIE, source: "environment OPENCODE_COOKIE" },
  ];

  for (const candidate of candidates) {
    const normalized = candidate.value ? normalizeCookieHeader(candidate.value) : "";
    if (normalized) {
      return { header: normalized, source: candidate.source };
    }
  }

  throw new Error(
    "OpenCode cookie header missing. Set OpenCode Cookie Header in preferences or OPENCODE_COOKIE_HEADER env.",
  );
}

function normalizeWorkspaceId(raw?: string): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  if (/^wrk_[A-Za-z0-9]+$/.test(value)) {
    return value;
  }
  const match = value.match(/wrk_[A-Za-z0-9]+/);
  return match?.[0];
}

function looksSignedOut(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("sign in") ||
    lower.includes("login") ||
    lower.includes("not authenticated") ||
    lower.includes("auth/authorize")
  );
}

function isExplicitNullPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.toLowerCase() === "null") {
    return true;
  }
  try {
    return JSON.parse(trimmed) === null;
  } catch {
    return false;
  }
}

function serverRequestUrl(serverId: string, args: unknown[] | undefined, method: "GET" | "POST"): string {
  if (method !== "GET") {
    return OPENCODE_SERVER_URL;
  }

  const params = new URLSearchParams();
  params.set("id", serverId);
  if (args && args.length > 0) {
    params.set("args", JSON.stringify(args));
  }
  return `${OPENCODE_SERVER_URL}?${params.toString()}`;
}

async function fetchServerText(
  serverId: string,
  cookieHeader: string,
  method: "GET" | "POST",
  args?: unknown[],
  referer = "https://opencode.ai",
): Promise<string> {
  const url = serverRequestUrl(serverId, args, method);
  const headers: Record<string, string> = {
    Cookie: cookieHeader,
    "X-Server-Id": serverId,
    "X-Server-Instance": `server-fn:${crypto.randomUUID()}`,
    "User-Agent": OPENCODE_USER_AGENT,
    Origin: "https://opencode.ai",
    Referer: referer,
    Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
  };
  const body = method === "POST" ? JSON.stringify(args ?? []) : undefined;
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || looksSignedOut(text)) {
      throw new Error("OpenCode session cookie is invalid or expired.");
    }
    throw new Error(`OpenCode API ${response.status}: ${text.slice(0, 220)}`);
  }
  return text;
}

function parseWorkspaceIdsFromText(text: string): string[] {
  const matches = text.match(/wrk_[A-Za-z0-9]+/g) ?? [];
  return Array.from(new Set(matches));
}

function parseWorkspaceIdsFromJson(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && /^wrk_[A-Za-z0-9]+$/.test(node)) {
        ids.add(node);
      }
      return;
    }

    for (const child of Object.values(node as Record<string, unknown>)) {
      visit(child);
    }
  };
  visit(value);
  return Array.from(ids);
}

function extractWithRegex(pattern: RegExp, text: string): number | undefined {
  const match = pattern.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseDateToResetInSeconds(value: unknown, now: Date): number | undefined {
  const parsedDate = parseDateLike(value);
  if (!parsedDate) {
    return undefined;
  }
  const at = Date.parse(parsedDate);
  if (Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, Math.round((at - now.getTime()) / 1000));
}

function readNumberByKeys(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const parsed = parseOptionalNumber(record[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function clampPercent(value: number): number {
  const normalized = value <= 1 && value >= 0 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

function parseWindowCandidate(
  record: Record<string, unknown>,
  now: Date,
): { usedPercent: number; resetInSec: number } | undefined {
  let usedPercent = readNumberByKeys(record, OPENCODE_PERCENT_KEYS);
  if (usedPercent === undefined) {
    const used = readNumberByKeys(record, OPENCODE_USED_KEYS);
    const limit = readNumberByKeys(record, OPENCODE_LIMIT_KEYS);
    if (used !== undefined && limit !== undefined && limit > 0) {
      usedPercent = (used / limit) * 100;
    }
  }
  if (usedPercent === undefined) {
    return undefined;
  }

  let resetInSec = readNumberByKeys(record, OPENCODE_RESET_IN_KEYS);
  if (resetInSec === undefined) {
    for (const key of OPENCODE_RESET_AT_KEYS) {
      resetInSec = parseDateToResetInSeconds(record[key], now);
      if (resetInSec !== undefined) {
        break;
      }
    }
  }

  return {
    usedPercent: clampPercent(usedPercent),
    resetInSec: Math.max(0, Math.round(resetInSec ?? 0)),
  };
}

function parseWindowFromObject(
  root: unknown,
  keys: string[],
  now: Date,
): { usedPercent: number; resetInSec: number } | undefined {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of keys) {
      const window = record[key];
      if (window && typeof window === "object" && !Array.isArray(window)) {
        const parsed = parseWindowCandidate(window as Record<string, unknown>, now);
        if (parsed) {
          return parsed;
        }
      }
    }

    queue.push(...Object.values(record));
  }
  return undefined;
}

function parseUsageDictionary(
  record: Record<string, unknown>,
  now: Date,
):
  | { rollingUsedPercent: number; rollingResetInSec: number; weeklyUsedPercent: number; weeklyResetInSec: number }
  | undefined {
  const rolling = parseWindowFromObject(record, ["rollingUsage", "rolling", "rolling_usage", "rollingWindow"], now);
  const weekly = parseWindowFromObject(record, ["weeklyUsage", "weekly", "weekly_usage", "weeklyWindow"], now);
  if (!rolling || !weekly) {
    return undefined;
  }
  return {
    rollingUsedPercent: rolling.usedPercent,
    rollingResetInSec: rolling.resetInSec,
    weeklyUsedPercent: weekly.usedPercent,
    weeklyResetInSec: weekly.resetInSec,
  };
}

interface WindowCandidate {
  id: string;
  usedPercent: number;
  resetInSec: number;
  pathLower: string;
}

function collectWindowCandidates(
  node: unknown,
  now: Date,
  path: string[],
  out: WindowCandidate[],
  seen: Set<string>,
): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      collectWindowCandidates(node[index], now, [...path, `[${index}]`], out, seen);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  const parsed = parseWindowCandidate(record, now);
  if (parsed) {
    const pathLower = path.join(".").toLowerCase();
    const id = `${pathLower}:${parsed.usedPercent}:${parsed.resetInSec}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        usedPercent: parsed.usedPercent,
        resetInSec: parsed.resetInSec,
        pathLower,
      });
    }
  }

  for (const [key, value] of Object.entries(record)) {
    collectWindowCandidates(value, now, [...path, key], out, seen);
  }
}

function pickCandidate(
  candidates: WindowCandidate[],
  shorterReset: boolean,
  excludedId?: string,
): WindowCandidate | undefined {
  const filtered = excludedId ? candidates.filter((candidate) => candidate.id !== excludedId) : candidates;
  if (filtered.length === 0) {
    return undefined;
  }
  return filtered.reduce(
    (best, current) => {
      if (!best) {
        return current;
      }
      if (shorterReset) {
        if (current.resetInSec === best.resetInSec) {
          return current.usedPercent > best.usedPercent ? current : best;
        }
        return current.resetInSec < best.resetInSec ? current : best;
      }
      if (current.resetInSec === best.resetInSec) {
        return current.usedPercent > best.usedPercent ? current : best;
      }
      return current.resetInSec > best.resetInSec ? current : best;
    },
    filtered[0] as WindowCandidate | undefined,
  );
}

function parseSubscriptionJson(
  object: unknown,
  now: Date,
):
  | { rollingUsedPercent: number; rollingResetInSec: number; weeklyUsedPercent: number; weeklyResetInSec: number }
  | undefined {
  if (!object || typeof object !== "object") {
    return undefined;
  }

  const queue: unknown[] = [object];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    const direct = parseUsageDictionary(record, now);
    if (direct) {
      return direct;
    }
    queue.push(...Object.values(record));
  }

  const candidates: WindowCandidate[] = [];
  const seen = new Set<string>();
  collectWindowCandidates(object, now, [], candidates, seen);
  if (candidates.length < 2) {
    return undefined;
  }

  const rollingPreferred = candidates.filter(
    (candidate) =>
      candidate.pathLower.includes("rolling") ||
      candidate.pathLower.includes("hour") ||
      candidate.pathLower.includes("5h") ||
      candidate.pathLower.includes("5-hour"),
  );
  const weeklyPreferred = candidates.filter(
    (candidate) => candidate.pathLower.includes("weekly") || candidate.pathLower.includes("week"),
  );

  const rolling = pickCandidate(rollingPreferred.length > 0 ? rollingPreferred : candidates, true);
  const weekly = pickCandidate(weeklyPreferred.length > 0 ? weeklyPreferred : candidates, false, rolling?.id);
  if (!rolling || !weekly) {
    return undefined;
  }

  return {
    rollingUsedPercent: rolling.usedPercent,
    rollingResetInSec: rolling.resetInSec,
    weeklyUsedPercent: weekly.usedPercent,
    weeklyResetInSec: weekly.resetInSec,
  };
}

function parseSubscription(
  text: string,
  now: Date,
):
  | { rollingUsedPercent: number; rollingResetInSec: number; weeklyUsedPercent: number; weeklyResetInSec: number }
  | undefined {
  try {
    const object = JSON.parse(text) as unknown;
    const parsed = parseSubscriptionJson(object, now);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall back to regex parser.
  }

  const rollingUsed = extractWithRegex(/rollingUsage[^}]*?usagePercent\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/, text);
  const rollingReset = extractWithRegex(/rollingUsage[^}]*?resetInSec\s*[:=]\s*([0-9]+)/, text);
  const weeklyUsed = extractWithRegex(/weeklyUsage[^}]*?usagePercent\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/, text);
  const weeklyReset = extractWithRegex(/weeklyUsage[^}]*?resetInSec\s*[:=]\s*([0-9]+)/, text);
  if (
    rollingUsed === undefined ||
    rollingReset === undefined ||
    weeklyUsed === undefined ||
    weeklyReset === undefined
  ) {
    return undefined;
  }

  return {
    rollingUsedPercent: clampPercent(rollingUsed),
    rollingResetInSec: Math.max(0, Math.round(rollingReset)),
    weeklyUsedPercent: clampPercent(weeklyUsed),
    weeklyResetInSec: Math.max(0, Math.round(weeklyReset)),
  };
}

async function fetchWorkspaceId(cookieHeader: string): Promise<string | undefined> {
  const getText = await fetchServerText(OPENCODE_WORKSPACES_SERVER_ID, cookieHeader, "GET");
  if (looksSignedOut(getText)) {
    throw new Error("OpenCode session cookie is invalid or expired.");
  }
  let ids = parseWorkspaceIdsFromText(getText);
  if (ids.length === 0) {
    try {
      ids = parseWorkspaceIdsFromJson(JSON.parse(getText));
    } catch {
      ids = [];
    }
  }
  if (ids.length > 0) {
    return ids[0];
  }

  const postText = await fetchServerText(OPENCODE_WORKSPACES_SERVER_ID, cookieHeader, "POST", []);
  if (looksSignedOut(postText)) {
    throw new Error("OpenCode session cookie is invalid or expired.");
  }
  ids = parseWorkspaceIdsFromText(postText);
  if (ids.length === 0) {
    try {
      ids = parseWorkspaceIdsFromJson(JSON.parse(postText));
    } catch {
      ids = [];
    }
  }
  return ids[0];
}

async function fetchSubscriptionTextWithFallback(
  workspaceId: string,
  cookieHeader: string,
  now: Date,
): Promise<string> {
  const referer = `https://opencode.ai/workspace/${workspaceId}/billing`;
  const getText = await fetchServerText(OPENCODE_SUBSCRIPTION_SERVER_ID, cookieHeader, "GET", [workspaceId], referer);
  if (looksSignedOut(getText)) {
    throw new Error("OpenCode session cookie is invalid or expired.");
  }
  if (isExplicitNullPayload(getText)) {
    throw new Error(`OpenCode returned no subscription usage for workspace ${workspaceId}.`);
  }
  if (parseSubscription(getText, now)) {
    return getText;
  }

  const postText = await fetchServerText(OPENCODE_SUBSCRIPTION_SERVER_ID, cookieHeader, "POST", [workspaceId], referer);
  if (looksSignedOut(postText)) {
    throw new Error("OpenCode session cookie is invalid or expired.");
  }
  if (isExplicitNullPayload(postText)) {
    throw new Error(`OpenCode returned no subscription usage for workspace ${workspaceId}.`);
  }
  return postText;
}

export async function fetchOpenCodeSnapshot(
  manualCookieHeader?: string,
  workspaceIdPreference?: string,
): Promise<ProviderUsageSnapshot> {
  const cookie = resolveCookieHeader(manualCookieHeader);
  const now = new Date();
  const workspaceOverride = workspaceIdPreference?.trim() || process.env.CODEXBAR_OPENCODE_WORKSPACE_ID?.trim();
  const workspaceId = normalizeWorkspaceId(workspaceOverride) ?? (await fetchWorkspaceId(cookie.header));
  if (!workspaceId) {
    throw new Error("OpenCode workspace ID not found in session.");
  }

  const subscriptionText = await fetchSubscriptionTextWithFallback(workspaceId, cookie.header, now);
  const usage = parseSubscription(subscriptionText, now);
  if (!usage) {
    throw new Error("OpenCode subscription usage fields are missing.");
  }

  const rollingRemaining = Math.max(0, Math.min(100, 100 - usage.rollingUsedPercent));
  const weeklyRemaining = Math.max(0, Math.min(100, 100 - usage.weeklyUsedPercent));

  return {
    provider: "opencode",
    planLabel: "Session",
    fetchedAt: now.toISOString(),
    quotas: [
      {
        id: "opencode-rolling",
        label: "5 Hour Limit",
        remainingPercent: rollingRemaining,
        remainingDisplay: `${rollingRemaining.toFixed(0)}% left`,
        resetAt: new Date(now.getTime() + usage.rollingResetInSec * 1000).toISOString(),
        status: statusFromRemainingPercent(rollingRemaining),
      },
      {
        id: "opencode-weekly",
        label: "Weekly Limit",
        remainingPercent: weeklyRemaining,
        remainingDisplay: `${weeklyRemaining.toFixed(0)}% left`,
        resetAt: new Date(now.getTime() + usage.weeklyResetInSec * 1000).toISOString(),
        status: statusFromRemainingPercent(weeklyRemaining),
      },
    ],
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: `OpenCode session cookie (${cookie.source})` },
          { label: "Workspace", value: workspaceId },
          { label: "Endpoint", value: OPENCODE_SERVER_URL },
        ],
      },
    ],
    rawPayload: {
      workspaceId,
      usage,
    },
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Resets use OpenCode rolling/weekly reset fields when available.",
  };
}
