import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { parseDateLike, parseOptionalNumber, safeString, statusFromRemainingPercent } from "../lib/normalize";

const ZAI_DEFAULT_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

type ZaiLimitType = "TIME_LIMIT" | "TOKENS_LIMIT";

interface ZaiLimitRaw {
  type?: unknown;
  unit?: unknown;
  number?: unknown;
  usage?: unknown;
  currentValue?: unknown;
  current_value?: unknown;
  remaining?: unknown;
  percentage?: unknown;
  nextResetTime?: unknown;
  next_reset_time?: unknown;
}

interface ZaiQuotaResponse {
  code?: unknown;
  msg?: unknown;
  success?: unknown;
  data?: {
    limits?: ZaiLimitRaw[];
    planName?: unknown;
    plan_name?: unknown;
    plan?: unknown;
    planType?: unknown;
    plan_type?: unknown;
    packageName?: unknown;
    package_name?: unknown;
  };
}

function resolveZaiApiKey(manual?: string): string {
  const candidates = [manual?.trim(), process.env.Z_AI_API_KEY?.trim()];
  for (const candidate of candidates) {
    if (candidate) {
      return candidate.replace(/^Bearer\s+/i, "");
    }
  }
  throw new Error("z.ai API key missing. Set z.ai API Key in preferences.");
}

function resolveZaiQuotaUrl(manual?: string): string {
  const fromEnv = process.env.Z_AI_QUOTA_URL?.trim();
  const fromHost = process.env.Z_AI_API_HOST?.trim();
  const candidate = manual?.trim() || fromEnv || fromHost || ZAI_DEFAULT_QUOTA_URL;
  if (/^https?:\/\//i.test(candidate)) {
    return candidate.replace(/\/+$/, "");
  }
  return `https://${candidate.replace(/\/+$/, "")}`;
}

function isSuccess(payload: ZaiQuotaResponse): boolean {
  const success = payload.success === true;
  const code = parseOptionalNumber(payload.code);
  return success && code === 200;
}

function normalizeEpochDate(value: unknown): string | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return parseDateLike(value);
  }
  const ms = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function windowLabel(unit: number | undefined, number: number | undefined): string | undefined {
  if (!unit || !number || number <= 0) {
    return undefined;
  }
  if (unit === 1) {
    return `${number} day${number === 1 ? "" : "s"}`;
  }
  if (unit === 3) {
    return `${number} hour${number === 1 ? "" : "s"}`;
  }
  if (unit === 5) {
    return `${number} minute${number === 1 ? "" : "s"}`;
  }
  return undefined;
}

function usedPercentFromLimit(limit: ZaiLimitRaw): number | undefined {
  const usage = parseOptionalNumber(limit.usage);
  const current = parseOptionalNumber(limit.currentValue ?? limit.current_value);
  const remaining = parseOptionalNumber(limit.remaining);

  if (usage !== undefined && usage > 0) {
    let usedRaw: number | undefined;
    if (remaining !== undefined) {
      const fromRemaining = usage - remaining;
      usedRaw = current !== undefined ? Math.max(fromRemaining, current) : fromRemaining;
    } else if (current !== undefined) {
      usedRaw = current;
    }

    if (usedRaw !== undefined) {
      return Math.max(0, Math.min(100, (Math.max(0, Math.min(usage, usedRaw)) / usage) * 100));
    }
  }

  const percentage = parseOptionalNumber(limit.percentage);
  if (percentage !== undefined) {
    return Math.max(0, Math.min(100, percentage));
  }

  return undefined;
}

function mapLimitToQuota(limit: ZaiLimitRaw, index: number): QuotaItem | undefined {
  const type = safeString(limit.type) as ZaiLimitType | undefined;
  if (type !== "TIME_LIMIT" && type !== "TOKENS_LIMIT") {
    return undefined;
  }

  const usedPercent = usedPercentFromLimit(limit);
  const remainingPercent = usedPercent !== undefined ? Math.max(0, Math.min(100, 100 - usedPercent)) : undefined;
  const number = parseOptionalNumber(limit.number);
  const unit = parseOptionalNumber(limit.unit);
  const usage = parseOptionalNumber(limit.usage);
  const remaining = parseOptionalNumber(limit.remaining);
  const label = type === "TOKENS_LIMIT" ? "Token Quota" : "Time Quota";
  const window = windowLabel(unit, number);
  const windowDisplay = window ? ` (${window} window)` : "";
  let remainingDisplay = `${remainingPercent !== undefined ? `${remainingPercent.toFixed(0)}% left` : "Usage available"}${windowDisplay}`;
  if (usage !== undefined && usage > 0 && remaining !== undefined) {
    remainingDisplay = `${Math.max(0, remaining).toFixed(0)} left of ${usage.toFixed(0)}${windowDisplay}`;
  }

  return {
    id: `zai-${type.toLowerCase()}-${index}`,
    label,
    remainingPercent,
    remainingDisplay,
    resetAt: normalizeEpochDate(limit.nextResetTime ?? limit.next_reset_time),
    status: statusFromRemainingPercent(remainingPercent),
  };
}

function detectPlanName(payload: ZaiQuotaResponse): string | undefined {
  const data = payload.data;
  const candidates = [
    safeString(data?.planName),
    safeString(data?.plan_name),
    safeString(data?.plan),
    safeString(data?.planType),
    safeString(data?.plan_type),
    safeString(data?.packageName),
    safeString(data?.package_name),
  ];
  return candidates.find((candidate) => !!candidate);
}

export async function fetchZaiSnapshot(manualApiKey?: string, manualQuotaUrl?: string): Promise<ProviderUsageSnapshot> {
  const apiKey = resolveZaiApiKey(manualApiKey);
  const quotaUrl = resolveZaiQuotaUrl(manualQuotaUrl);

  const response = await fetch(quotaUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("z.ai API key is invalid.");
    }
    const body = await response.text();
    throw new Error(`z.ai API ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = (await response.json()) as ZaiQuotaResponse;
  if (!isSuccess(payload)) {
    throw new Error(`z.ai API error: ${safeString(payload.msg) ?? "Unknown response status."}`);
  }

  const quotas = (payload.data?.limits ?? [])
    .map((limit, index) => mapLimitToQuota(limit, index))
    .filter((quota): quota is QuotaItem => !!quota);
  if (quotas.length === 0) {
    throw new Error("z.ai response did not include parseable limits.");
  }

  const planLabel = detectPlanName(payload) ?? "API";
  return {
    provider: "zai",
    planLabel,
    fetchedAt: new Date().toISOString(),
    quotas,
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: "z.ai API key" },
          { label: "Endpoint", value: quotaUrl },
        ],
      },
    ],
    rawPayload: payload,
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Resets come from z.ai `limits[].nextResetTime` when provided.",
  };
}
