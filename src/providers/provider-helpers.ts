import { ProviderId, ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { discoverBrowserCookieCandidates } from "../lib/browser-cookies";
import { execFile } from "child_process";
import {
  formatCompactNumber,
  formatPercent,
  parseDateLike,
  parseOptionalNumber,
  safeString,
  statusFromRemainingPercent,
} from "../lib/normalize";

export function bearerToken(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "");
}

export function firstConfiguredSecret(label: string, candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return bearerToken(normalized);
    }
  }
  throw new Error(`${label} missing. Set it in preferences or environment.`);
}

export function firstConfiguredOptional(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export async function requestJson<T>(url: string, options: RequestInit, authFailureMessage: string): Promise<T> {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(authFailureMessage);
    }
    throw new Error(`HTTP ${response.status} (${url}): ${text.slice(0, 220)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Endpoint returned non-JSON response (${url}).`);
  }
}

export function collectRecords(root: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    records.push(record);
    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(root);
  return records;
}

export function readFirstNumber(root: unknown, keys: string[]): number | undefined {
  for (const record of collectRecords(root)) {
    for (const key of keys) {
      const parsed = parseOptionalNumber(record[key]);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function readFirstString(root: unknown, keys: string[]): string | undefined {
  for (const record of collectRecords(root)) {
    for (const key of keys) {
      const value = safeString(record[key]);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

export function sumNumbers(root: unknown, keys: string[]): number | undefined {
  let total = 0;
  let found = false;
  for (const record of collectRecords(root)) {
    for (const key of keys) {
      const parsed = parseOptionalNumber(record[key]);
      if (parsed !== undefined) {
        total += parsed;
        found = true;
        break;
      }
    }
  }
  return found ? total : undefined;
}

export function readFirstDate(root: unknown, keys: string[]): string | undefined {
  for (const record of collectRecords(root)) {
    for (const key of keys) {
      const parsed = parseDateLike(record[key]);
      if (parsed) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function buildCurrencyQuota(input: {
  id: string;
  label: string;
  remaining?: number;
  total?: number;
  used?: number;
  currency?: string;
}): QuotaItem {
  const currency = input.currency ?? "USD";
  const total = input.total !== undefined ? Math.max(0, input.total) : undefined;
  const used = input.used !== undefined ? Math.max(0, input.used) : undefined;
  const remaining =
    input.remaining !== undefined
      ? Math.max(0, input.remaining)
      : total !== undefined && used !== undefined
        ? Math.max(0, total - used)
        : undefined;
  const remainingPercent =
    total !== undefined && total > 0 && remaining !== undefined ? (remaining / total) * 100 : undefined;
  const parts =
    total !== undefined && remaining !== undefined
      ? `${currency} ${remaining.toFixed(2)} left of ${currency} ${total.toFixed(2)}`
      : used !== undefined
        ? `${currency} ${used.toFixed(2)} used`
        : remaining !== undefined
          ? `${currency} ${remaining.toFixed(2)} balance`
          : "Usage data available";

  return {
    id: input.id,
    label: input.label,
    remainingPercent,
    remainingDisplay: parts,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export function buildCountQuota(input: {
  id: string;
  label: string;
  remaining?: number;
  total?: number;
  used?: number;
  unit?: string;
  resetAt?: string;
}): QuotaItem {
  const total = input.total !== undefined ? Math.max(0, input.total) : undefined;
  const used = input.used !== undefined ? Math.max(0, input.used) : undefined;
  const remaining =
    input.remaining !== undefined
      ? Math.max(0, input.remaining)
      : total !== undefined && used !== undefined
        ? Math.max(0, total - used)
        : undefined;
  const remainingPercent =
    total !== undefined && total > 0 && remaining !== undefined ? (remaining / total) * 100 : undefined;
  const unit = input.unit ? ` ${input.unit}` : "";
  const display =
    total !== undefined && remaining !== undefined
      ? `${formatCompactNumber(remaining)} left of ${formatCompactNumber(total)}${unit}`
      : total !== undefined && used !== undefined
        ? `${formatCompactNumber(used)} used of ${formatCompactNumber(total)}${unit}`
        : used !== undefined
          ? `${formatCompactNumber(used)}${unit} used`
          : remaining !== undefined
            ? `${formatCompactNumber(remaining)}${unit} remaining`
            : "Usage data available";

  return {
    id: input.id,
    label: input.label,
    remainingPercent,
    remainingDisplay: display,
    resetAt: input.resetAt,
    trendBadge: remainingPercent !== undefined ? `${formatPercent(100 - remainingPercent)} used` : undefined,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export function buildSnapshot(input: {
  provider: ProviderId;
  planLabel?: string;
  quotas: QuotaItem[];
  endpoint: string;
  sourceLabel: string;
  rawPayload: unknown;
  resetPolicy?: string;
  highlights?: string[];
  fetchedAt?: string;
}): ProviderUsageSnapshot {
  return {
    provider: input.provider,
    planLabel: input.planLabel,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    quotas: input.quotas,
    source: "api",
    highlights: input.highlights,
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: input.sourceLabel },
          { label: "Endpoint", value: input.endpoint },
        ],
      },
    ],
    rawPayload: input.rawPayload,
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: input.resetPolicy,
  };
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

export function normalizeCookieHeader(value: string): string {
  const trimmed = value.trim();
  const fromCurl = /(?:^|\s)curl\s+/i.test(trimmed) ? parseCookieFromCurlInput(trimmed) : undefined;
  const fromMultiline = trimmed.includes("\n") ? parseCookieLineFromMultilineInput(trimmed) : undefined;
  const source = fromCurl ?? fromMultiline ?? trimmed;
  return source
    .replace(/^cookie:\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .join("; ");
}

export async function resolveCookieCandidates(options: {
  manual?: string;
  cached?: string;
  env?: Array<string | undefined>;
  sourceMode?: "auto" | "manual";
  domains: string[];
  requiredCookieNames?: string[];
}): Promise<{ candidates: Array<{ header: string; source: string }>; hasChromiumV20: boolean }> {
  const candidates: Array<{ header: string; source: string }> = [];
  const pushCandidate = (header: string | undefined, source: string) => {
    if (!header) {
      return;
    }
    const normalized = normalizeCookieHeader(header);
    if (!normalized || candidates.some((candidate) => candidate.header === normalized)) {
      return;
    }
    candidates.push({ header: normalized, source });
  };

  pushCandidate(options.manual, "manual preference");
  pushCandidate(options.cached, "cache");
  for (const envCookie of options.env ?? []) {
    pushCandidate(envCookie, "environment");
  }

  if (options.sourceMode === "manual") {
    return { candidates, hasChromiumV20: false };
  }

  const discovery = await discoverBrowserCookieCandidates(options.domains, {
    requiredCookieNames: options.requiredCookieNames,
  });
  for (const candidate of discovery.candidates) {
    pushCandidate(candidate.header, candidate.source);
  }

  return { candidates, hasChromiumV20: discovery.hasChromiumV20 };
}

export function runCommandText(binary: string, args: string[], timeoutMs = 12000): Promise<string> {
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

export function parseJsonObjectFromText(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Some CLIs print logs around JSON; try the largest object-looking slice.
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
