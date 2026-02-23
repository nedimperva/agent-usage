import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import {
  formatPercent,
  parseDateLike,
  parseOptionalNumber,
  safeString,
  statusFromRemainingPercent,
  toRemainingPercent,
} from "../lib/normalize";

const PERCENT_LEFT_PATTERN = /(\d+(?:\.\d+)?)\s*%\s*left/i;
const TREND_PATTERN = /([+-]\d+(?:\.\d+)?%)/;
const RESET_PATTERN = /reset(?:s|ting)?(?:\s+on)?[:\s]+([A-Za-z0-9,.\-: ]+)/i;
const DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api";

interface CodexCredentials {
  accessToken: string;
  accountId?: string;
}

interface CodexUsageWindow {
  used_percent?: unknown;
  reset_at?: unknown;
  limit_window_seconds?: unknown;
}

interface CodexUsageResponse {
  plan_type?: unknown;
  rate_limit?: {
    primary_window?: CodexUsageWindow;
    secondary_window?: CodexUsageWindow;
  };
  credits?: {
    has_credits?: unknown;
    unlimited?: unknown;
    balance?: unknown;
  };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function resolveCodexHome(): string {
  const codeHome = process.env.CODEX_HOME?.trim();
  if (codeHome) {
    return codeHome;
  }
  return path.join(os.homedir(), ".codex");
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function deepFindString(input: unknown, keys: string[]): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const queue: unknown[] = [input];
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null) {
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of keys) {
      const maybe = safeString(record[key]);
      if (maybe) {
        return maybe;
      }
    }

    queue.push(...Object.values(record));
  }

  return undefined;
}

function parseChatGPTBaseURL(configToml: string | undefined): string {
  if (!configToml) {
    return DEFAULT_CHATGPT_BASE_URL;
  }

  const match = configToml.match(/^\s*chatgpt_base_url\s*=\s*(.+)$/m);
  if (!match) {
    return DEFAULT_CHATGPT_BASE_URL;
  }

  const raw = stripQuotes(match[1]);
  if (!raw) {
    return DEFAULT_CHATGPT_BASE_URL;
  }

  let normalized = raw.replace(/\/+$/, "");
  if (
    (normalized.startsWith("https://chatgpt.com") || normalized.startsWith("https://chat.openai.com")) &&
    !normalized.includes("/backend-api")
  ) {
    normalized = `${normalized}/backend-api`;
  }

  return normalized;
}

async function loadCodexCredentials(manualToken?: string): Promise<CodexCredentials> {
  const manual = manualToken?.trim();
  if (manual) {
    return {
      accessToken: manual.replace(/^Bearer\s+/i, ""),
    };
  }

  const codexHome = resolveCodexHome();
  const authPath = path.join(codexHome, "auth.json");
  const authRaw = await readFileIfExists(authPath);
  if (!authRaw) {
    throw new Error(`Codex auth not found at ${authPath}. Run \`codex login\` first.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(authRaw);
  } catch {
    throw new Error(`Codex auth.json is invalid JSON at ${authPath}.`);
  }

  const accessToken = deepFindString(parsed, ["access_token", "accessToken", "token"]);
  if (!accessToken) {
    throw new Error(`No access token found in ${authPath}. Re-run \`codex login\`.`);
  }

  const accountId = deepFindString(parsed, ["account_id", "accountId", "chatgpt_account_id"]);
  return { accessToken, accountId };
}

function buildWindowQuota(
  window: CodexUsageWindow | undefined,
  fallbackLabel: string,
  fallbackId: string,
): QuotaItem | undefined {
  if (!window) {
    return undefined;
  }

  const usedPercent = parseOptionalNumber(window.used_percent);
  if (usedPercent === undefined) {
    return undefined;
  }

  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
  const resetSeconds = parseOptionalNumber(window.reset_at);
  const resetAt = resetSeconds !== undefined ? new Date(resetSeconds * 1000).toISOString() : undefined;
  const windowMinutes = parseOptionalNumber(window.limit_window_seconds);

  let label = fallbackLabel;
  if (windowMinutes !== undefined) {
    if (windowMinutes <= 5 * 60 * 60) {
      label = "5 Hour Limit";
    } else if (windowMinutes >= 6 * 24 * 60 * 60) {
      label = "Weekly Limit";
    }
  }

  return {
    id: fallbackId,
    label,
    remainingPercent,
    remainingDisplay: `${formatPercent(remainingPercent)} left`,
    resetAt,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export function mapCodexUsageToQuotas(payload: CodexUsageResponse): QuotaItem[] {
  const quotas: QuotaItem[] = [];
  const primary = buildWindowQuota(payload.rate_limit?.primary_window, "Primary Limit", "codex-primary-limit");
  const secondary = buildWindowQuota(payload.rate_limit?.secondary_window, "Weekly Limit", "codex-secondary-limit");

  if (primary) {
    quotas.push(primary);
  }
  if (secondary) {
    quotas.push(secondary);
  }

  const balance = parseOptionalNumber(payload.credits?.balance);
  const hasCredits = payload.credits?.has_credits === true;
  if (hasCredits && balance !== undefined) {
    quotas.push({
      id: "codex-credits",
      label: "Credits",
      remainingDisplay: `${balance.toFixed(2)} remaining`,
      status: "unknown",
    });
  }

  return quotas;
}

export async function fetchCodexSnapshot(manualToken?: string): Promise<ProviderUsageSnapshot> {
  const credentials = await loadCodexCredentials(manualToken);
  const codexHome = resolveCodexHome();
  const configToml = await readFileIfExists(path.join(codexHome, "config.toml"));
  const baseUrl = parseChatGPTBaseURL(configToml);
  const url = `${baseUrl}/wham/usage`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "User-Agent": "agent-usage-raycast",
      ...(credentials.accountId ? { "ChatGPT-Account-Id": credentials.accountId } : {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Codex token is expired/invalid. Re-run `codex login` and refresh.");
    }
    const body = await response.text();
    throw new Error(`Codex usage API ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = (await response.json()) as CodexUsageResponse;
  const quotas = mapCodexUsageToQuotas(payload);
  if (quotas.length === 0) {
    throw new Error("Codex usage API returned no parseable limits.");
  }

  return {
    provider: "codex",
    planLabel: safeString(payload.plan_type) ?? "OAuth",
    fetchedAt: new Date().toISOString(),
    quotas,
    source: "api",
  };
}

function parseQuotaFromObject(item: unknown, defaultId: number): QuotaItem | undefined {
  if (typeof item !== "object" || item === null) {
    return undefined;
  }

  const record = item as Record<string, unknown>;
  const label =
    safeString(record.label) ?? safeString(record.name) ?? safeString(record.title) ?? `Limit ${defaultId + 1}`;
  const id = safeString(record.id) ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const trendBadge =
    safeString(record.trendBadge) ??
    safeString(record.trend) ??
    safeString(record.delta) ??
    safeString(record.changePercent);
  const resetAt =
    parseDateLike(record.resetAt) ??
    parseDateLike(record.reset_at) ??
    parseDateLike(record.resetDate) ??
    parseDateLike(record.renewsAt);

  const directPercent =
    toRemainingPercent(record.remainingPercent) ??
    toRemainingPercent(record.remaining_percent) ??
    toRemainingPercent(record.percentLeft) ??
    toRemainingPercent(record.percent_left);

  const limit =
    parseOptionalNumber(record.limit) ?? parseOptionalNumber(record.max) ?? parseOptionalNumber(record.quota);
  const used =
    parseOptionalNumber(record.used) ?? parseOptionalNumber(record.spent) ?? parseOptionalNumber(record.consumed);
  const explicitRemaining = parseOptionalNumber(record.remaining);

  let remainingPercent = directPercent;
  if (remainingPercent === undefined && limit !== undefined && limit > 0) {
    const remaining = explicitRemaining ?? (used !== undefined ? Math.max(0, limit - used) : undefined);
    if (remaining !== undefined) {
      remainingPercent = Math.max(0, Math.min(100, (remaining / limit) * 100));
    }
  }

  const remainingDisplay =
    safeString(record.remainingDisplay) ??
    safeString(record.display) ??
    safeString(record.remainingText) ??
    (remainingPercent !== undefined ? `${formatPercent(remainingPercent)} left` : "Imported");

  return {
    id,
    label,
    remainingPercent,
    remainingDisplay,
    resetAt,
    trendBadge,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

function parseJsonImport(parsed: unknown): QuotaItem[] {
  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => parseQuotaFromObject(item, index)).filter((item): item is QuotaItem => !!item);
  }

  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.quotas)) {
    return record.quotas
      .map((item, index) => parseQuotaFromObject(item, index))
      .filter((item): item is QuotaItem => !!item);
  }

  if (Array.isArray(record.limits)) {
    return record.limits
      .map((item, index) => parseQuotaFromObject(item, index))
      .filter((item): item is QuotaItem => !!item);
  }

  const single = parseQuotaFromObject(record, 0);
  return single ? [single] : [];
}

function parseLineImport(input: string): QuotaItem[] {
  const lines = input.split(/\r?\n/).map((line) => line.trim());
  const quotas: QuotaItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const match = line.match(/^(.+?):\s*(.+)$/);
    if (!match) {
      continue;
    }

    const label = match[1].trim();
    const value = match[2].trim();

    const percentMatch = value.match(PERCENT_LEFT_PATTERN);
    const remainingPercent = percentMatch ? Number(percentMatch[1]) : undefined;
    const trendBadge = value.match(TREND_PATTERN)?.[1];

    const resetRaw = value.match(RESET_PATTERN)?.[1];
    const resetAt = parseDateLike(resetRaw);

    quotas.push({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label,
      remainingPercent,
      remainingDisplay: value,
      resetAt,
      trendBadge,
      status: statusFromRemainingPercent(remainingPercent),
    });
  }

  return quotas;
}

export function parseCodexImport(input: string, now = new Date()): ProviderUsageSnapshot {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Import payload is empty.");
  }

  let quotas: QuotaItem[] = [];
  try {
    const parsed = JSON.parse(trimmed);
    quotas = parseJsonImport(parsed);
  } catch {
    quotas = parseLineImport(trimmed);
  }

  if (quotas.length === 0) {
    throw new Error("Could not parse any usage rows. Use JSON with quotas[] or `Label: value` lines.");
  }

  return {
    provider: "codex",
    planLabel: "Imported",
    fetchedAt: now.toISOString(),
    quotas,
    source: "import",
  };
}
