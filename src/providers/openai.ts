import { QuotaItem } from "../models/usage";
import {
  buildCurrencyQuota,
  buildCountQuota,
  buildSnapshot,
  firstConfiguredOptional,
  requestJson,
} from "./provider-helpers";
import { formatCompactNumber, parseOptionalNumber, safeString } from "../lib/normalize";

const OPENAI_API_BASE = "https://api.openai.com/v1";

interface OpenAIBucket {
  start_time?: unknown;
  end_time?: unknown;
  results?: Array<Record<string, unknown>>;
}

interface OpenAIUsageResponse {
  data?: OpenAIBucket[];
}

interface OpenAICreditGrantsResponse {
  total_available?: unknown;
  total_granted?: unknown;
  total_used?: unknown;
}

function resolveOpenAIKey(adminKey?: string, apiKey?: string): { key: string; sourceLabel: string } {
  const admin = firstConfiguredOptional([adminKey, process.env.OPENAI_ADMIN_KEY]);
  if (admin) {
    return { key: admin.replace(/^Bearer\s+/i, ""), sourceLabel: "OpenAI Admin API key" };
  }

  const fallback = firstConfiguredOptional([apiKey, process.env.OPENAI_API_KEY]);
  if (fallback) {
    return { key: fallback.replace(/^Bearer\s+/i, ""), sourceLabel: "OpenAI API key (legacy balance fallback)" };
  }

  throw new Error("OpenAI key missing. Set OpenAI Admin API Key or OpenAI API Key in preferences.");
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function bucketStartMs(bucket: OpenAIBucket): number {
  const parsed = parseOptionalNumber(bucket.start_time);
  return parsed !== undefined ? parsed * 1000 : 0;
}

function sumBucketResults(bucket: OpenAIBucket, keys: string[]): number {
  return (bucket.results ?? []).reduce((total, result) => {
    for (const key of keys) {
      const parsed = parseOptionalNumber(result[key]);
      if (parsed !== undefined) {
        return total + parsed;
      }
    }
    return total;
  }, 0);
}

function sumBucketsSince(payload: OpenAIUsageResponse | undefined, sinceMs: number, keys: string[]): number {
  return (payload?.data ?? [])
    .filter((bucket) => bucketStartMs(bucket) >= sinceMs)
    .reduce((total, bucket) => total + sumBucketResults(bucket, keys), 0);
}

export function mapOpenAIUsageToQuotas(
  costs: OpenAIUsageResponse | undefined,
  completions: OpenAIUsageResponse | undefined,
  credits?: OpenAICreditGrantsResponse,
  now = new Date(),
): QuotaItem[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sevenDaysAgo = now.getTime() - 7 * dayMs;
  const thirtyDaysAgo = now.getTime() - 30 * dayMs;
  const costKeys = ["amount_value", "amount", "cost", "cost_usd"];
  const requestKeys = ["num_model_requests", "requests", "request_count"];
  const tokenKeys = ["input_tokens", "output_tokens", "input_cached_tokens", "tokens"];
  const totalAvailable = parseOptionalNumber(credits?.total_available);
  const totalGranted = parseOptionalNumber(credits?.total_granted);
  const totalUsed = parseOptionalNumber(credits?.total_used);
  const quotas: QuotaItem[] = [];

  const todaySpend = sumBucketsSince(costs, todayStart, costKeys);
  const spend7d = sumBucketsSince(costs, sevenDaysAgo, costKeys);
  const spend30d = sumBucketsSince(costs, thirtyDaysAgo, costKeys);
  if (spend30d > 0 || spend7d > 0 || todaySpend > 0) {
    quotas.push({
      id: "openai-api-spend-30d",
      label: "API Spend",
      remainingDisplay: `USD ${spend30d.toFixed(2)} in 30d (7d ${spend7d.toFixed(2)}, today ${todaySpend.toFixed(2)})`,
      status: "unknown",
    });
  }

  const requests30d = sumBucketsSince(completions, thirtyDaysAgo, requestKeys);
  if (requests30d > 0) {
    quotas.push(buildCountQuota({ id: "openai-api-requests-30d", label: "Requests (30d)", used: requests30d }));
  }

  const tokens30d = sumBucketsSince(completions, thirtyDaysAgo, tokenKeys);
  if (tokens30d > 0) {
    quotas.push(
      buildCountQuota({ id: "openai-api-tokens-30d", label: "Tokens (30d)", used: tokens30d, unit: "tokens" }),
    );
  }

  if (totalAvailable !== undefined || totalGranted !== undefined || totalUsed !== undefined) {
    quotas.push(
      buildCurrencyQuota({
        id: "openai-api-credits",
        label: "Credits",
        remaining: totalAvailable,
        total: totalGranted,
        used: totalUsed,
      }),
    );
  }

  if (quotas.length === 0) {
    quotas.push({
      id: "openai-api-available",
      label: "API Access",
      remainingDisplay: "Key is valid, but no spend/usage rows were returned for the last 30 days.",
      status: "unknown",
    });
  }

  return quotas;
}

async function tryRequestOpenAI<T>(url: string, apiKey: string): Promise<T | undefined> {
  try {
    return await requestJson<T>(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      "OpenAI key is invalid or lacks usage permissions.",
    );
  } catch {
    return undefined;
  }
}

export async function fetchOpenAISnapshot(adminKey?: string, apiKey?: string) {
  const resolved = resolveOpenAIKey(adminKey, apiKey);
  const now = new Date();
  const start = epochSeconds(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const costsEndpoint = `${OPENAI_API_BASE}/organization/costs?start_time=${start}&bucket_width=1d&limit=31`;
  const completionsEndpoint = `${OPENAI_API_BASE}/organization/usage/completions?start_time=${start}&bucket_width=1d&limit=31`;
  const creditsEndpoint = `${OPENAI_API_BASE}/dashboard/billing/credit_grants`;

  const [costs, completions, credits] = await Promise.all([
    tryRequestOpenAI<OpenAIUsageResponse>(costsEndpoint, resolved.key),
    tryRequestOpenAI<OpenAIUsageResponse>(completionsEndpoint, resolved.key),
    tryRequestOpenAI<OpenAICreditGrantsResponse>(creditsEndpoint, resolved.key),
  ]);

  if (!costs && !completions && !credits) {
    throw new Error("OpenAI usage and credit endpoints returned no readable data. Use an Admin API key for org usage.");
  }

  const quotas = mapOpenAIUsageToQuotas(costs, completions, credits, now);
  const requestTotal = quotas.find((quota) => quota.id === "openai-api-requests-30d")?.remainingDisplay;
  const highlights = [
    requestTotal ? `Requests: ${requestTotal}` : undefined,
    costs ? "Admin costs readable" : undefined,
    completions ? "Admin completions readable" : undefined,
    credits ? "Credit balance readable" : undefined,
  ].filter((value): value is string => !!safeString(value));

  const snapshot = buildSnapshot({
    provider: "openai",
    planLabel: resolved.sourceLabel.includes("Admin") ? "Admin API" : "API Key",
    quotas,
    endpoint: costs ? costsEndpoint : creditsEndpoint,
    sourceLabel: resolved.sourceLabel,
    rawPayload: { costs, completions, credits },
    highlights,
    resetPolicy:
      "Spend/usage buckets come from OpenAI organization usage endpoints when an Admin API key is available.",
  });

  snapshot.metadataSections?.push({
    id: "usage-summary",
    title: "Usage Summary",
    items: [
      { label: "30d spend", value: quotas[0]?.remainingDisplay ?? "unknown" },
      { label: "30d requests", value: requestTotal ?? "unknown" },
      {
        label: "30d tokens",
        value: `${formatCompactNumber(sumBucketsSince(completions, now.getTime() - 30 * 24 * 60 * 60 * 1000, ["input_tokens", "output_tokens", "input_cached_tokens", "tokens"]))}`,
      },
    ],
  });

  return snapshot;
}
