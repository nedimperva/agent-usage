import {
  buildCountQuota,
  buildSnapshot,
  firstConfiguredSecret,
  readFirstNumber,
  requestJson,
} from "./provider-helpers";

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

function resolveUsageUrl(manualUrl?: string): string {
  return manualUrl?.trim() || process.env.GROQCLOUD_USAGE_URL?.trim() || process.env.GROQ_USAGE_URL?.trim() || "";
}

export function mapGroqCloudUsage(payload: unknown, keyValidated: boolean) {
  const requests = readFirstNumber(payload, ["requests", "request_count", "num_requests", "total_requests"]);
  const tokens = readFirstNumber(payload, ["tokens", "total_tokens", "input_tokens", "output_tokens"]);
  const cacheHits = readFirstNumber(payload, ["cache_hits", "cacheHits"]);
  const quotas = [];

  if (requests !== undefined) {
    quotas.push(buildCountQuota({ id: "groqcloud-requests", label: "Requests", used: requests }));
  }
  if (tokens !== undefined) {
    quotas.push(buildCountQuota({ id: "groqcloud-tokens", label: "Tokens", used: tokens, unit: "tokens" }));
  }
  if (cacheHits !== undefined) {
    quotas.push(buildCountQuota({ id: "groqcloud-cache-hits", label: "Cache Hits", used: cacheHits }));
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "groqcloud-access",
      label: "API Access",
      remainingDisplay: keyValidated
        ? "API key is valid. Configure GroqCloud Usage URL for enterprise metrics."
        : "Usage data unavailable.",
      status: "unknown" as const,
    });
  }
  return quotas;
}

export async function fetchGroqCloudSnapshot(apiKey?: string, usageUrl?: string) {
  const resolvedKey = firstConfiguredSecret("GroqCloud API key", [
    apiKey,
    process.env.GROQCLOUD_API_KEY,
    process.env.GROQ_API_KEY,
  ]);
  const configuredUsageUrl = resolveUsageUrl(usageUrl);
  const endpoint = configuredUsageUrl || GROQ_MODELS_URL;
  let payload: unknown;
  let keyValidated = false;

  if (configuredUsageUrl) {
    payload = await requestJson<unknown>(
      configuredUsageUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${resolvedKey}`,
          Accept: "application/json",
        },
      },
      "GroqCloud API key is invalid or lacks usage-metrics access.",
    );
    keyValidated = true;
  } else {
    payload = await requestJson<unknown>(
      GROQ_MODELS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${resolvedKey}`,
          Accept: "application/json",
        },
      },
      "GroqCloud API key is invalid.",
    );
    keyValidated = true;
  }

  return buildSnapshot({
    provider: "groqcloud",
    planLabel: configuredUsageUrl ? "Usage API" : "API Key",
    quotas: mapGroqCloudUsage(payload, keyValidated),
    endpoint,
    sourceLabel: configuredUsageUrl ? "GroqCloud usage API" : "GroqCloud API key validation",
    rawPayload: payload,
    resetPolicy: "GroqCloud public API validates access; enterprise usage metrics require a configured usage URL.",
  });
}
