import { ProviderUsageSnapshot, QuotaItem, QuotaStatus } from "../models/usage";
import { discoverBrowserCookieCandidates } from "../lib/browser-cookies";
import { clampPercent, parseDateLike, safeString, statusFromRemainingPercent } from "../lib/normalize";

const ZED_ACCOUNT_URL = "https://dashboard.zed.dev/account";
const ZED_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type ZedCookieSourceMode = "auto" | "manual";

interface ZedCookieCandidate {
  header: string;
  source: string;
}

export interface ZedFetchOptions {
  cookieHeader?: string;
  cookieSourceMode?: ZedCookieSourceMode;
  cachedCookieHeader?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

export interface ParsedZedAccountPage {
  planLabel?: string;
  includedCreditLimit?: number;
  includedCreditUsed?: number;
  includedCreditRemaining?: number;
  tokenSpendLimit?: number;
  cycleSpend?: number;
  spendLimitBlocked?: boolean;
  billingDate?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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

export function normalizeZedCookieHeader(value: string): string {
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

function normalizeZedSourceMode(value: string | undefined): ZedCookieSourceMode {
  if (value?.toLowerCase() === "manual") {
    return "manual";
  }
  return "auto";
}

export async function resolveZedCookieCandidates(options: ZedFetchOptions): Promise<{
  candidates: ZedCookieCandidate[];
  hasChromiumV20: boolean;
}> {
  const manual = options.cookieHeader?.trim();
  const sourceMode = normalizeZedSourceMode(options.cookieSourceMode);
  const candidates: ZedCookieCandidate[] = [];
  const pushCandidate = (header: string | undefined, source: string) => {
    if (!header) {
      return;
    }
    const normalized = normalizeZedCookieHeader(header);
    if (!normalized) {
      return;
    }
    if (candidates.some((candidate) => candidate.header === normalized)) {
      return;
    }
    candidates.push({ header: normalized, source });
  };

  pushCandidate(manual, "manual preference");
  if (sourceMode === "manual") {
    return { candidates, hasChromiumV20: false };
  }

  const cached = options.cachedCookieHeader?.trim();
  const envCookie = process.env.ZED_COOKIE_HEADER?.trim() || process.env.ZED_COOKIE?.trim();
  pushCandidate(cached, "cache");
  pushCandidate(envCookie, "environment");

  const discovery = await discoverBrowserCookieCandidates(["dashboard.zed.dev", "zed.dev"]);
  for (const candidate of discovery.candidates) {
    pushCandidate(candidate.header, candidate.source);
  }

  return {
    candidates,
    hasChromiumV20: discovery.hasChromiumV20,
  };
}

export function looksLikeZedSignInPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("sign in") ||
    lower.includes("log in") ||
    lower.includes("continue with github") ||
    lower.includes("continue with google") ||
    lower.includes("/sign_in") ||
    lower.includes("/login")
  );
}

function formatUsd(value: number): string {
  return `USD ${value.toFixed(2)}`;
}

function parseCurrencyAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(/-?\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function hasMeaningfulUsage(value: ParsedZedAccountPage): boolean {
  return (
    value.includedCreditLimit !== undefined ||
    value.includedCreditUsed !== undefined ||
    value.includedCreditRemaining !== undefined ||
    value.tokenSpendLimit !== undefined ||
    value.cycleSpend !== undefined ||
    value.spendLimitBlocked !== undefined ||
    value.billingDate !== undefined ||
    value.planLabel !== undefined
  );
}

function mergeDefined(target: ParsedZedAccountPage, partial: Partial<ParsedZedAccountPage>): void {
  for (const [key, value] of Object.entries(partial) as Array<
    [keyof ParsedZedAccountPage, ParsedZedAccountPage[keyof ParsedZedAccountPage]]
  >) {
    if (value !== undefined && target[key] === undefined) {
      (target as Record<keyof ParsedZedAccountPage, string | number | boolean | undefined>)[key] = value;
    }
  }
}

function readValueByNormalizedKeys<T>(
  record: Record<string, unknown>,
  keys: string[],
  parser: (value: unknown) => T | undefined,
): T | undefined {
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeLabel(key);
    if (!keys.includes(normalized)) {
      continue;
    }
    const parsed = parser(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function labelFromRecord(record: Record<string, unknown>): string | undefined {
  const labelKeys = ["label", "title", "name", "heading", "metric", "description"];
  for (const key of labelKeys) {
    const value = safeString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function matchesAlias(value: string | undefined, aliases: string[]): boolean {
  if (!value) {
    return false;
  }
  const normalized = normalizeLabel(value);
  return aliases.some((alias) => normalized.includes(normalizeLabel(alias)));
}

function readBucket(record: Record<string, unknown>): {
  limit?: number;
  used?: number;
  remaining?: number;
  blocked?: boolean;
  date?: string;
} {
  return {
    limit: readValueByNormalizedKeys(
      record,
      ["limit", "total", "amount", "cap", "budget", "allowance", "maximum", "monthlycap", "includedamount"],
      parseCurrencyAmount,
    ),
    used: readValueByNormalizedKeys(
      record,
      ["used", "usage", "spent", "current", "consumed", "usedamount", "currentspend", "usageamount"],
      parseCurrencyAmount,
    ),
    remaining: readValueByNormalizedKeys(
      record,
      ["remaining", "left", "available", "remainingamount", "remainingcredit"],
      parseCurrencyAmount,
    ),
    blocked: readValueByNormalizedKeys(
      record,
      ["blocked", "isblocked", "usageblocked", "spendlimitreached", "paymentfailed"],
      parseBooleanValue,
    ),
    date: readValueByNormalizedKeys(
      record,
      ["billingdate", "nextbillingdate", "billingcycleend", "currentperiodend", "periodend", "renewson", "renewaldate"],
      parseDateLike,
    ),
  };
}

function mergeJsonRecord(target: ParsedZedAccountPage, record: Record<string, unknown>): void {
  const label = labelFromRecord(record);

  const planLabel = readValueByNormalizedKeys(
    record,
    ["plan", "planname", "subscriptionplan", "tier", "subscriptiontier"],
    safeString,
  );
  if (planLabel && !matchesAlias(planLabel, ["invoice history", "billing"])) {
    mergeDefined(target, { planLabel });
  }

  const billingDate = readValueByNormalizedKeys(
    record,
    ["billingdate", "nextbillingdate", "billingcycleend", "currentperiodend", "periodend", "renewson", "renewaldate"],
    parseDateLike,
  );
  mergeDefined(target, { billingDate });

  const blocked = readValueByNormalizedKeys(
    record,
    ["blocked", "isblocked", "usageblocked", "hostedusageblocked", "spendlimitreached", "paymentfailed"],
    parseBooleanValue,
  );
  mergeDefined(target, { spendLimitBlocked: blocked });

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeLabel(key);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const bucket = readBucket(value as Record<string, unknown>);
    if (normalizedKey.includes("included") && normalizedKey.includes("credit")) {
      mergeDefined(target, {
        includedCreditLimit: bucket.limit,
        includedCreditUsed: bucket.used,
        includedCreditRemaining: bucket.remaining,
        billingDate: bucket.date,
      });
    } else if (
      (normalizedKey.includes("spend") && normalizedKey.includes("limit")) ||
      (normalizedKey.includes("token") && normalizedKey.includes("spend")) ||
      normalizedKey.includes("spendcap")
    ) {
      mergeDefined(target, {
        tokenSpendLimit: bucket.limit,
        cycleSpend: bucket.used,
        spendLimitBlocked: bucket.blocked,
        billingDate: bucket.date,
      });
    }
  }

  if (matchesAlias(label, ["included credit", "monthly included credit", "included usage credit"])) {
    const bucket = readBucket(record);
    mergeDefined(target, {
      includedCreditLimit: bucket.limit,
      includedCreditUsed: bucket.used,
      includedCreditRemaining: bucket.remaining,
      billingDate: bucket.date,
    });
  }

  if (matchesAlias(label, ["maximum token spend", "token spend limit", "max token spend", "spend limit"])) {
    const bucket = readBucket(record);
    mergeDefined(target, {
      tokenSpendLimit: bucket.limit,
      cycleSpend: bucket.used,
      spendLimitBlocked: bucket.blocked,
      billingDate: bucket.date,
    });
  }

  if (matchesAlias(label, ["current cycle spend", "cycle spend", "current spend", "incremental spend"])) {
    mergeDefined(target, {
      cycleSpend:
        readValueByNormalizedKeys(
          record,
          ["amount", "value", "current", "spent", "usage", "used", "currentspend"],
          parseCurrencyAmount,
        ) ?? parseCurrencyAmount(label),
    });
  }

  if (matchesAlias(label, ["billing date", "next billing date", "renews on", "billing cycle end"])) {
    mergeDefined(target, {
      billingDate:
        readValueByNormalizedKeys(record, ["value", "date", "billingdate", "nextbillingdate"], parseDateLike) ??
        parseDateLike(label),
    });
  }

  if (matchesAlias(label, ["usage blocked", "hosted usage blocked"])) {
    mergeDefined(target, { spendLimitBlocked: true });
  }

  const includedLimit = readValueByNormalizedKeys(
    record,
    ["includedcreditlimit", "monthlyincludedcredit", "includedallowance", "includedcreditamount"],
    parseCurrencyAmount,
  );
  const includedUsed = readValueByNormalizedKeys(
    record,
    ["includedcreditused", "usedincludedcredit", "creditused", "includedusage"],
    parseCurrencyAmount,
  );
  const includedRemaining = readValueByNormalizedKeys(
    record,
    ["includedcreditremaining", "remainingincludedcredit", "remainingcredit"],
    parseCurrencyAmount,
  );
  mergeDefined(target, {
    includedCreditLimit: includedLimit,
    includedCreditUsed: includedUsed,
    includedCreditRemaining: includedRemaining,
  });

  const tokenSpendLimit = readValueByNormalizedKeys(
    record,
    ["tokenspendlimit", "maxtokenspend", "maximumtokenspend", "spendcap", "billingcap"],
    parseCurrencyAmount,
  );
  const cycleSpend = readValueByNormalizedKeys(
    record,
    ["currentspend", "cyclespend", "currentcyclespend", "monthtodatespend", "incrementalspend", "hostedspend"],
    parseCurrencyAmount,
  );
  mergeDefined(target, { tokenSpendLimit, cycleSpend });
}

function walkJson(node: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walkJson(child, visitor);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  visitor(record);
  for (const value of Object.values(record)) {
    walkJson(value, visitor);
  }
}

function extractScriptJsonCandidates(html: string): string[] {
  const regex = /<script[^>]*?(?:type=["']application\/json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const content = match[1]?.trim();
    if (content) {
      results.push(content);
    }
  }
  return results;
}

function findBalancedJsonEnd(text: string, start: number): number {
  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
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
    if (char === opening) {
      depth += 1;
      continue;
    }
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractJsonBlobCandidates(html: string, maxCandidates = 40): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < html.length && results.length < maxCandidates; index += 1) {
    const opening = html[index];
    if (opening !== "{" && opening !== "[") {
      continue;
    }
    const nextNonWhitespace = html.slice(index + 1).match(/\S/);
    if (!nextNonWhitespace) {
      break;
    }
    const nextChar = nextNonWhitespace[0];
    if (opening === "{" && nextChar !== '"' && nextChar !== "}") {
      continue;
    }
    if (opening === "[" && nextChar !== "{" && nextChar !== "[" && nextChar !== "]") {
      continue;
    }

    const end = findBalancedJsonEnd(html, index);
    if (end < 0) {
      continue;
    }
    const candidate = html.slice(index, end + 1).trim();
    if (candidate.length < 2 || candidate.length > 250000 || seen.has(candidate)) {
      index = end;
      continue;
    }
    try {
      JSON.parse(candidate);
      seen.add(candidate);
      results.push(candidate);
      index = end;
    } catch {
      // Ignore invalid blobs.
    }
  }

  return results;
}

function parseStructuredCandidates(candidates: string[]): ParsedZedAccountPage {
  const parsed: ParsedZedAccountPage = {};
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(candidate) as unknown;
      walkJson(json, (record) => mergeJsonRecord(parsed, record));
    } catch {
      // Ignore invalid JSON candidates.
    }
  }
  return parsed;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function visibleTextFromHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

function currencyValues(text: string): number[] {
  return Array.from(text.matchAll(/(?:USD\s*|\$)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/gi))
    .map((match) => match[1]?.replace(/,/g, ""))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function sliceAfterFirstLabel(
  text: string,
  labels: string[],
  length = 160,
  stopLabels: string[] = [],
): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(escapeRegExp(label), "i");
    const match = pattern.exec(text);
    if (!match?.index && match?.index !== 0) {
      continue;
    }

    let end = Math.min(text.length, match.index + length);
    for (const stopLabel of stopLabels) {
      const stopPattern = new RegExp(escapeRegExp(stopLabel), "ig");
      stopPattern.lastIndex = match.index + match[0].length;
      const stopMatch = stopPattern.exec(text);
      if (stopMatch?.index !== undefined && stopMatch.index < end) {
        end = stopMatch.index;
      }
    }

    return text.slice(match.index, end);
  }
  return undefined;
}

function parseIncludedCreditFromText(text: string): Partial<ParsedZedAccountPage> {
  const snippet = sliceAfterFirstLabel(
    text,
    ["Included Credit", "Monthly Included Credit", "Included Usage Credit"],
    120,
    [
      "Maximum Token Spend",
      "Token Spend Limit",
      "Max Token Spend",
      "Spend Limit",
      "Current Cycle Spend",
      "Cycle Spend",
      "Current Spend",
      "Billing Date",
      "Next Billing Date",
      "Renews On",
      "Billing Cycle End",
    ],
  );
  if (!snippet) {
    return {};
  }

  const amounts = currencyValues(snippet);
  if (amounts.length >= 2) {
    const normalized = snippet.toLowerCase();
    if (normalized.includes("remaining") || normalized.includes("left")) {
      return {
        includedCreditRemaining: amounts[0],
        includedCreditLimit: amounts[1],
      };
    }
    return {
      includedCreditUsed: amounts[0],
      includedCreditLimit: amounts[1],
    };
  }

  if (amounts.length === 1) {
    return { includedCreditLimit: amounts[0] };
  }

  return {};
}

function parseTokenSpendFromText(text: string): Partial<ParsedZedAccountPage> {
  const spendLimitSnippet = sliceAfterFirstLabel(text, [
    "Maximum Token Spend",
    "Token Spend Limit",
    "Max Token Spend",
    "Spend Limit",
  ]);
  const cycleSpendSnippet = sliceAfterFirstLabel(text, [
    "Current Cycle Spend",
    "Cycle Spend",
    "Current Spend",
    "Incremental Spend",
  ]);
  const result: Partial<ParsedZedAccountPage> = {};

  if (spendLimitSnippet) {
    const amounts = currencyValues(spendLimitSnippet);
    if (amounts.length > 0) {
      result.tokenSpendLimit = amounts[0];
      if (amounts.length > 1 && result.cycleSpend === undefined) {
        result.cycleSpend = amounts[1];
      }
    }
  }

  if (cycleSpendSnippet) {
    const amounts = currencyValues(cycleSpendSnippet);
    if (amounts.length > 0) {
      result.cycleSpend = amounts[0];
    }
  }

  return result;
}

function parseBillingDateFromText(text: string): string | undefined {
  const snippet = sliceAfterFirstLabel(
    text,
    ["Billing Date", "Next Billing Date", "Renews On", "Billing Cycle End"],
    120,
  );
  if (!snippet) {
    return undefined;
  }

  const monthDate = snippet.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/);
  if (monthDate) {
    return parseDateLike(`${monthDate[1]} ${monthDate[2]}, ${monthDate[3]} UTC`);
  }

  const isoDate = snippet.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate?.[0]) {
    return parseDateLike(`${isoDate[0]}T00:00:00Z`);
  }

  const slashDate = snippet.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashDate) {
    const month = slashDate[1].padStart(2, "0");
    const day = slashDate[2].padStart(2, "0");
    return parseDateLike(`${slashDate[3]}-${month}-${day}T00:00:00Z`);
  }

  return undefined;
}

function parsePlanLabelFromText(text: string): string | undefined {
  const match = text.match(/\b(Zed Pro|Pro|Personal|Enterprise)\b/i);
  if (!match?.[0]) {
    return undefined;
  }
  const normalized = match[0].trim();
  return /^zed /i.test(normalized) ? normalized : `Zed ${normalized}`;
}

function parseTextFallback(html: string): ParsedZedAccountPage {
  const text = visibleTextFromHtml(html);
  const result: ParsedZedAccountPage = {};
  mergeDefined(result, parseIncludedCreditFromText(text));
  mergeDefined(result, parseTokenSpendFromText(text));
  mergeDefined(result, {
    billingDate: parseBillingDateFromText(text),
    planLabel: parsePlanLabelFromText(text),
    spendLimitBlocked:
      /hosted (?:model|usage)s? blocked|usage blocked|payment (?:failed|overdue)|spend limit reached/i.test(text)
        ? true
        : undefined,
  });
  return result;
}

export function parseZedAccountPage(html: string): ParsedZedAccountPage | undefined {
  const scriptCandidates = extractScriptJsonCandidates(html);
  const scriptParsed = parseStructuredCandidates(scriptCandidates);
  if (hasMeaningfulUsage(scriptParsed)) {
    const textFallback = parseTextFallback(html);
    mergeDefined(scriptParsed, textFallback);
    return scriptParsed;
  }

  const blobCandidates = extractJsonBlobCandidates(html);
  const blobParsed = parseStructuredCandidates(blobCandidates);
  if (hasMeaningfulUsage(blobParsed)) {
    const textFallback = parseTextFallback(html);
    mergeDefined(blobParsed, textFallback);
    return blobParsed;
  }

  const textParsed = parseTextFallback(html);
  return hasMeaningfulUsage(textParsed) ? textParsed : undefined;
}

function quotaStatusForAbsoluteValue(status: QuotaStatus | undefined, forcedCritical = false): QuotaStatus {
  if (forcedCritical) {
    return "critical";
  }
  return status ?? "unknown";
}

function buildIncludedCreditQuota(parsed: ParsedZedAccountPage): QuotaItem | undefined {
  const limit = parsed.includedCreditLimit;
  if (limit === undefined) {
    return undefined;
  }

  const remaining =
    parsed.includedCreditRemaining !== undefined
      ? Math.max(0, parsed.includedCreditRemaining)
      : parsed.includedCreditUsed !== undefined
        ? Math.max(0, limit - parsed.includedCreditUsed)
        : undefined;
  const remainingPercent = remaining !== undefined && limit > 0 ? clampPercent((remaining / limit) * 100) : undefined;
  const remainingDisplay =
    remaining !== undefined
      ? `${formatUsd(remaining)} left of ${formatUsd(limit)}`
      : parsed.includedCreditUsed !== undefined
        ? `${formatUsd(parsed.includedCreditUsed)} used of ${formatUsd(limit)}`
        : `${formatUsd(limit)} included`;

  return {
    id: "zed-included-credit",
    label: "Included Credit",
    remainingPercent,
    remainingDisplay,
    resetAt: parsed.billingDate,
    status: quotaStatusForAbsoluteValue(statusFromRemainingPercent(remainingPercent)),
  };
}

function buildTokenSpendQuota(parsed: ParsedZedAccountPage): QuotaItem | undefined {
  const limit = parsed.tokenSpendLimit;
  if (limit === undefined) {
    return undefined;
  }

  const remaining = parsed.cycleSpend !== undefined ? Math.max(0, limit - Math.max(0, parsed.cycleSpend)) : undefined;
  const remainingPercent = remaining !== undefined && limit > 0 ? clampPercent((remaining / limit) * 100) : undefined;
  const remainingDisplay =
    remaining !== undefined
      ? `${formatUsd(remaining)} left of ${formatUsd(limit)}`
      : parsed.cycleSpend !== undefined
        ? `${formatUsd(parsed.cycleSpend)} spent of ${formatUsd(limit)}`
        : `Cap ${formatUsd(limit)}`;

  return {
    id: "zed-token-spend-limit",
    label: "Token Spend Limit",
    remainingPercent,
    remainingDisplay,
    resetAt: parsed.billingDate,
    status: quotaStatusForAbsoluteValue(statusFromRemainingPercent(remainingPercent), parsed.spendLimitBlocked),
  };
}

export async function fetchZedSnapshot(input?: string | ZedFetchOptions): Promise<ProviderUsageSnapshot> {
  const options: ZedFetchOptions = typeof input === "string" ? { cookieHeader: input } : (input ?? {});
  const sourceMode = normalizeZedSourceMode(options.cookieSourceMode);
  const resolved = await resolveZedCookieCandidates(options);
  if (resolved.candidates.length === 0) {
    if (sourceMode === "manual") {
      throw new Error("Zed Cookie Source is manual, but no Zed Cookie Header is configured.");
    }
    if (resolved.hasChromiumV20) {
      throw new Error(
        "Zed browser cookies are Chrome app-bound (`v20`) and cannot be auto-read here. Use Manual mode and paste a Cookie header from dashboard.zed.dev/account.",
      );
    }
    throw new Error(
      "No Zed cookie session found. Set header manually or use Auto with an authenticated browser session.",
    );
  }

  let parsed: ParsedZedAccountPage | undefined;
  let selectedCookie: ZedCookieCandidate | undefined;
  let lastError: Error | undefined;
  const attemptedSources: string[] = [];

  for (const candidate of resolved.candidates) {
    attemptedSources.push(candidate.source);
    try {
      const response = await fetch(ZED_ACCOUNT_URL, {
        method: "GET",
        headers: {
          Cookie: candidate.header,
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": ZED_USER_AGENT,
        },
      });
      const html = await response.text();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || looksLikeZedSignInPage(html)) {
          throw new Error("Zed session cookie is invalid or expired.");
        }
        throw new Error(`Zed account request failed (${response.status}).`);
      }

      if (looksLikeZedSignInPage(html)) {
        throw new Error("Zed session cookie is invalid or expired.");
      }

      const parsedCandidate = parseZedAccountPage(html);
      if (!parsedCandidate) {
        throw new Error("Zed account usage data was not found on the account page.");
      }

      parsed = parsedCandidate;
      selectedCookie = candidate;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!parsed || !selectedCookie) {
    const attempted = attemptedSources.length > 0 ? ` Tried sources: ${attemptedSources.join(", ")}.` : "";
    const reason = lastError?.message ?? "Zed cookie is invalid/expired. Sign in to dashboard.zed.dev and refresh.";
    const v20Hint =
      resolved.hasChromiumV20 && sourceMode === "auto"
        ? " Browser cookies appear app-bound (`v20`); use Manual mode with a copied Cookie header."
        : "";
    throw new Error(`${reason}${attempted}${v20Hint}`);
  }

  if (options.onCookieResolved) {
    await options.onCookieResolved(selectedCookie.header, selectedCookie.source);
  }

  const quotas = [buildIncludedCreditQuota(parsed), buildTokenSpendQuota(parsed)].filter(
    (quota): quota is QuotaItem => !!quota,
  );
  if (quotas.length === 0) {
    throw new Error("Zed account page did not include parseable quota data.");
  }

  const highlights = [
    parsed.cycleSpend !== undefined ? `Current cycle spend: ${formatUsd(parsed.cycleSpend)}` : undefined,
    parsed.includedCreditLimit !== undefined ? `Included credit: ${formatUsd(parsed.includedCreditLimit)}` : undefined,
    parsed.tokenSpendLimit !== undefined ? `Max token spend: ${formatUsd(parsed.tokenSpendLimit)}` : undefined,
    parsed.billingDate ? `Billing date: ${parsed.billingDate}` : undefined,
    parsed.spendLimitBlocked ? "Hosted usage blocked by spend limit." : undefined,
  ].filter((value): value is string => !!value);

  return {
    provider: "zed",
    planLabel: parsed.planLabel,
    fetchedAt: new Date().toISOString(),
    quotas,
    highlights,
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Cookie source mode", value: sourceMode },
          { label: "Cookie source", value: selectedCookie.source },
          { label: "Source", value: "Zed account page (cookie session)" },
          { label: "Endpoint", value: ZED_ACCOUNT_URL },
        ],
      },
      {
        id: "billing-summary",
        title: "Billing Summary",
        items: [
          ...(parsed.cycleSpend !== undefined
            ? [{ label: "Current cycle spend", value: formatUsd(parsed.cycleSpend) }]
            : []),
          ...(parsed.includedCreditLimit !== undefined
            ? [{ label: "Included credit", value: formatUsd(parsed.includedCreditLimit) }]
            : []),
          ...(parsed.tokenSpendLimit !== undefined
            ? [{ label: "Max token spend", value: formatUsd(parsed.tokenSpendLimit) }]
            : []),
          ...(parsed.billingDate ? [{ label: "Billing date", value: parsed.billingDate }] : []),
          ...(parsed.spendLimitBlocked !== undefined
            ? [{ label: "Hosted usage blocked", value: parsed.spendLimitBlocked ? "yes" : "no" }]
            : []),
        ],
      },
    ],
    rawPayload: parsed,
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Reset follows Zed billing date/account-cycle data when present.",
  };
}
