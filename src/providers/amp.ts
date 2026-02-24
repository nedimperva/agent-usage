import { ProviderUsageSnapshot } from "../models/usage";
import { discoverBrowserCookieCandidates } from "../lib/browser-cookies";
import { formatPercent, parseDateLike, parseOptionalNumber, statusFromRemainingPercent } from "../lib/normalize";

const AMP_SETTINGS_URL = "https://ampcode.com/settings";
const AMP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface AmpUsageData {
  quota: number;
  used: number;
  hourly: number;
  windowHours?: number;
  resetAt?: string;
}

type AmpCookieSourceMode = "auto" | "manual";

interface AmpCookieCandidate {
  header: string;
  source: string;
}

interface AmpFetchOptions {
  cookieHeader?: string;
  cookieSourceMode?: AmpCookieSourceMode;
  cachedCookieHeader?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
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

function normalizeAmpSourceMode(value: string | undefined): AmpCookieSourceMode {
  if (value?.toLowerCase() === "manual") {
    return "manual";
  }
  return "auto";
}

async function resolveAmpCookieCandidates(options: AmpFetchOptions): Promise<{
  candidates: AmpCookieCandidate[];
  hasChromiumV20: boolean;
}> {
  const manual = options.cookieHeader?.trim();
  const cached = options.cachedCookieHeader?.trim();
  const envCookie = process.env.AMP_COOKIE_HEADER?.trim() || process.env.AMP_COOKIE?.trim();
  const sourceMode = normalizeAmpSourceMode(options.cookieSourceMode);
  const candidates: AmpCookieCandidate[] = [];
  const pushCandidate = (header: string | undefined, source: string) => {
    if (!header) {
      return;
    }
    const normalized = normalizeCookieHeader(header);
    if (!normalized) {
      return;
    }
    if (candidates.some((candidate) => candidate.header === normalized)) {
      return;
    }
    candidates.push({ header: normalized, source });
  };

  pushCandidate(manual, "manual preference");
  pushCandidate(cached, "cache");
  pushCandidate(envCookie, "environment");
  if (sourceMode === "manual") {
    return { candidates, hasChromiumV20: false };
  }

  const discovery = await discoverBrowserCookieCandidates(["ampcode.com"]);
  for (const candidate of discovery.candidates) {
    pushCandidate(candidate.header, candidate.source);
  }

  return {
    candidates,
    hasChromiumV20: discovery.hasChromiumV20,
  };
}

function extractObjectByToken(text: string, token: string): string | undefined {
  const tokenIndex = text.indexOf(token);
  if (tokenIndex < 0) {
    return undefined;
  }

  const braceIndex = text.indexOf("{", tokenIndex + token.length);
  if (braceIndex < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = braceIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(braceIndex, index + 1);
      }
    }
  }

  return undefined;
}

function parseNumberFromLooseObject(objectText: string, key: string): number | undefined {
  const patterns = [
    new RegExp(`["']?${key}["']?\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"),
    new RegExp(`\\b${key}\\b\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = objectText.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const numeric = Number(match[1]);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return undefined;
}

function parseStringFromLooseObject(objectText: string, key: string): string | undefined {
  const pattern = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']+)["']`, "i");
  const match = objectText.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function parseAmpUsageObject(objectText: string): AmpUsageData | undefined {
  const quota = parseNumberFromLooseObject(objectText, "quota");
  const used = parseNumberFromLooseObject(objectText, "used");
  const hourly = parseNumberFromLooseObject(objectText, "hourlyReplenishment");
  if (quota === undefined || used === undefined || hourly === undefined) {
    return undefined;
  }

  return {
    quota,
    used,
    hourly,
    windowHours: parseNumberFromLooseObject(objectText, "windowHours"),
    resetAt:
      parseStringFromLooseObject(objectText, "resetAt") ??
      parseStringFromLooseObject(objectText, "nextResetAt") ??
      parseStringFromLooseObject(objectText, "next_reset_at"),
  };
}

function extractNextDataJson(html: string): string | undefined {
  const match = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim();
}

function findAmpUsageData(node: unknown): AmpUsageData | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findAmpUsageData(child);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  const record = node as Record<string, unknown>;
  const candidates = [
    record,
    typeof record.freeTierUsage === "object" ? (record.freeTierUsage as Record<string, unknown>) : undefined,
    typeof record.getFreeTierUsage === "object" ? (record.getFreeTierUsage as Record<string, unknown>) : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const quota = parseOptionalNumber(candidate.quota);
    const used = parseOptionalNumber(candidate.used);
    const hourly = parseOptionalNumber(candidate.hourlyReplenishment);
    if (quota !== undefined && used !== undefined && hourly !== undefined) {
      return {
        quota,
        used,
        hourly,
        windowHours: parseOptionalNumber(candidate.windowHours),
        resetAt: parseDateLike(candidate.resetAt ?? candidate.nextResetAt ?? candidate.next_reset_at),
      };
    }
  }

  for (const value of Object.values(record)) {
    const found = findAmpUsageData(value);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function parseAmpUsage(html: string): AmpUsageData | undefined {
  const tokenObjects = [
    extractObjectByToken(html, "freeTierUsage"),
    extractObjectByToken(html, "getFreeTierUsage"),
    extractObjectByToken(html, '"freeTierUsage"'),
  ].filter((value): value is string => !!value);
  for (const objectText of tokenObjects) {
    const parsed = parseAmpUsageObject(objectText);
    if (parsed) {
      return parsed;
    }
  }

  const tokenIndex = html.indexOf("freeTierUsage");
  if (tokenIndex >= 0) {
    const chunk = html.slice(Math.max(0, tokenIndex - 200), Math.min(html.length, tokenIndex + 1800));
    const parsed = parseAmpUsageObject(chunk);
    if (parsed) {
      return parsed;
    }
  }

  const nextData = extractNextDataJson(html);
  if (nextData) {
    try {
      const parsed = findAmpUsageData(JSON.parse(nextData));
      if (parsed) {
        return parsed;
      }
    } catch {
      // Fall through.
    }
  }

  return undefined;
}

function looksSignedOut(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("sign in") ||
    lower.includes("log in") ||
    lower.includes("login") ||
    lower.includes("/login") ||
    lower.includes("ampcode.com/login")
  );
}

export async function fetchAmpSnapshot(input?: string | AmpFetchOptions): Promise<ProviderUsageSnapshot> {
  const options: AmpFetchOptions = typeof input === "string" ? { cookieHeader: input } : (input ?? {});
  const sourceMode = normalizeAmpSourceMode(options.cookieSourceMode);
  const resolved = await resolveAmpCookieCandidates(options);
  if (resolved.candidates.length === 0) {
    if (sourceMode === "manual") {
      throw new Error("Amp Cookie Source is manual, but no Amp Cookie Header is configured.");
    }
    if (resolved.hasChromiumV20) {
      throw new Error(
        "Amp browser cookies are Chrome app-bound (`v20`) and cannot be auto-read here. Use Manual mode and paste a Cookie header from ampcode.com/settings.",
      );
    }
    throw new Error("No Amp cookie session found. Set header manually or use Auto with an authenticated browser.");
  }

  let usage: AmpUsageData | undefined;
  let selectedCookie: AmpCookieCandidate | undefined;
  let lastError: Error | undefined;
  const attemptedSources: string[] = [];
  for (const candidate of resolved.candidates) {
    attemptedSources.push(candidate.source);
    const response = await fetch(AMP_SETTINGS_URL, {
      method: "GET",
      headers: {
        Cookie: candidate.header,
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": AMP_USER_AGENT,
      },
    });
    const html = await response.text();

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || looksSignedOut(html)) {
        lastError = new Error("Amp session cookie is invalid or expired.");
        continue;
      }
      lastError = new Error(`Amp settings request failed (${response.status}).`);
      continue;
    }

    const parsedUsage = parseAmpUsage(html);
    if (!parsedUsage) {
      if (looksSignedOut(html)) {
        lastError = new Error("Amp session cookie is invalid or expired.");
        continue;
      }
      lastError = new Error("Amp Free usage data not found on settings page.");
      continue;
    }

    usage = parsedUsage;
    selectedCookie = candidate;
    break;
  }

  if (!usage || !selectedCookie) {
    const attempted = attemptedSources.length > 0 ? ` Tried sources: ${attemptedSources.join(", ")}.` : "";
    const reason = lastError?.message ?? "Amp cookie is invalid/expired. Sign in to ampcode.com and refresh.";
    const v20Hint =
      resolved.hasChromiumV20 && sourceMode === "auto"
        ? " Browser cookies appear app-bound (`v20`); use Manual mode with a copied Cookie header."
        : "";
    throw new Error(`${reason}${attempted}${v20Hint}`);
  }

  if (options.onCookieResolved) {
    await options.onCookieResolved(selectedCookie.header, selectedCookie.source);
  }

  const quota = Math.max(0, usage.quota);
  const used = Math.max(0, usage.used);
  const hourly = Math.max(0, usage.hourly);
  const remaining = Math.max(0, quota - used);
  const remainingPercent = quota > 0 ? Math.max(0, Math.min(100, (remaining / quota) * 100)) : undefined;
  const usedPercent = remainingPercent !== undefined ? 100 - remainingPercent : 0;
  const estimatedResetAt =
    quota > 0 && hourly > 0
      ? new Date(Date.now() + (Math.max(0, used) / hourly) * 60 * 60 * 1000).toISOString()
      : undefined;
  const resetAt = parseDateLike(usage.resetAt) ?? estimatedResetAt;
  const windowMinutes =
    usage.windowHours !== undefined && usage.windowHours > 0 ? Math.round(usage.windowHours * 60) : undefined;

  return {
    provider: "amp",
    planLabel: "Amp Free",
    fetchedAt: new Date().toISOString(),
    quotas: [
      {
        id: "amp-free-tier",
        label: "Free Tier",
        remainingPercent,
        remainingDisplay:
          quota > 0
            ? `${formatPercent(remainingPercent ?? 0)} left (${formatPercent(usedPercent)} used of ${quota.toFixed(0)})`
            : "Usage available",
        resetAt,
        status: statusFromRemainingPercent(remainingPercent),
      },
    ],
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Cookie source mode", value: sourceMode },
          { label: "Cookie source", value: selectedCookie.source },
          { label: "Source", value: "Amp settings page (cookie session)" },
          { label: "Endpoint", value: AMP_SETTINGS_URL },
          { label: "Hourly replenishment", value: `${hourly.toFixed(2)}` },
          { label: "Window", value: windowMinutes ? `${windowMinutes} minutes` : "unknown" },
        ],
      },
    ],
    rawPayload: {
      usage,
    },
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Reset uses Amp free-tier reset field when present, otherwise hourly replenishment estimate.",
  };
}
