import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { formatPercent, parseOptionalNumber, safeString, statusFromRemainingPercent } from "../lib/normalize";

const OPENROUTER_DEFAULT_API_BASE = "https://openrouter.ai/api/v1";

interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: unknown;
    total_usage?: unknown;
  };
}

interface OpenRouterKeyResponse {
  data?: {
    limit?: unknown;
    usage?: unknown;
    rate_limit?: {
      requests?: unknown;
      interval?: unknown;
    };
  };
}

function resolveOpenRouterApiKey(manual?: string): string {
  const candidates = [manual?.trim(), process.env.OPENROUTER_API_KEY?.trim()];
  for (const candidate of candidates) {
    if (candidate) {
      return candidate.replace(/^Bearer\s+/i, "");
    }
  }
  throw new Error("OpenRouter API key missing. Set OpenRouter API Key in preferences.");
}

function resolveOpenRouterBaseUrl(manualBaseUrl?: string): string {
  const base = manualBaseUrl?.trim() || process.env.OPENROUTER_API_URL?.trim() || OPENROUTER_DEFAULT_API_BASE;
  return base.replace(/\/+$/, "");
}

async function requestOpenRouterJson<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "X-Title": "Agent Usage",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("OpenRouter API key is invalid.");
    }
    const body = await response.text();
    throw new Error(`OpenRouter API ${response.status}: ${body.slice(0, 220)}`);
  }

  return (await response.json()) as T;
}

async function requestOpenRouterKey(url: string, apiKey: string): Promise<OpenRouterKeyResponse | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as OpenRouterKeyResponse;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCreditsQuota(totalCredits: number | undefined, totalUsage: number | undefined): QuotaItem {
  const total = Math.max(0, totalCredits ?? 0);
  const usage = Math.max(0, totalUsage ?? 0);
  const remaining = Math.max(0, total - usage);
  const remainingPercent = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : undefined;

  return {
    id: "openrouter-credits",
    label: "Credits",
    remainingPercent,
    remainingDisplay:
      total > 0
        ? `USD ${remaining.toFixed(2)} left of USD ${total.toFixed(2)} (${formatPercent(100 - (remainingPercent ?? 0))} used)`
        : `USD ${remaining.toFixed(2)} balance`,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

function buildKeyLimitQuota(payload: OpenRouterKeyResponse | undefined): QuotaItem | undefined {
  const limit = parseOptionalNumber(payload?.data?.limit);
  const usage = parseOptionalNumber(payload?.data?.usage);
  if (limit === undefined || usage === undefined || limit <= 0) {
    return undefined;
  }

  const remaining = Math.max(0, limit - usage);
  const remainingPercent = Math.max(0, Math.min(100, (remaining / limit) * 100));
  return {
    id: "openrouter-key-quota",
    label: "Key Quota",
    remainingPercent,
    remainingDisplay: `${remaining.toFixed(2)} left of ${limit.toFixed(2)}`,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export async function fetchOpenRouterSnapshot(
  manualApiKey?: string,
  manualApiBaseUrl?: string,
): Promise<ProviderUsageSnapshot> {
  const apiKey = resolveOpenRouterApiKey(manualApiKey);
  const apiBase = resolveOpenRouterBaseUrl(manualApiBaseUrl);
  const creditsEndpoint = `${apiBase}/credits`;
  const keyEndpoint = `${apiBase}/key`;

  const credits = await requestOpenRouterJson<OpenRouterCreditsResponse>(creditsEndpoint, apiKey);
  const key = await requestOpenRouterKey(keyEndpoint, apiKey);

  const totalCredits = parseOptionalNumber(credits.data?.total_credits);
  const totalUsage = parseOptionalNumber(credits.data?.total_usage);
  const quotas: QuotaItem[] = [buildCreditsQuota(totalCredits, totalUsage)];
  const keyQuota = buildKeyLimitQuota(key);
  if (keyQuota) {
    quotas.push(keyQuota);
  }

  const requests = parseOptionalNumber(key?.data?.rate_limit?.requests);
  const interval = safeString(key?.data?.rate_limit?.interval);

  return {
    provider: "openrouter",
    planLabel: "API",
    fetchedAt: new Date().toISOString(),
    quotas,
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: "OpenRouter API key" },
          { label: "Credits endpoint", value: creditsEndpoint },
          { label: "Key endpoint", value: keyEndpoint },
          { label: "Rate limit", value: requests !== undefined ? `${requests}/${interval ?? "window"}` : "unknown" },
        ],
      },
    ],
    rawPayload: {
      credits,
      key,
    },
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Credit totals are cumulative; key quota/rate limits come from OpenRouter `/key`.",
  };
}
