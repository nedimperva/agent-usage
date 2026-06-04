import {
  buildCountQuota,
  buildSnapshot,
  firstConfiguredSecret,
  readFirstDate,
  readFirstNumber,
  requestJson,
} from "./provider-helpers";

const WARP_GRAPHQL_URL = "https://app.warp.dev/graphql";

const WARP_USAGE_QUERY = `
query AgentUsageWarpUsage {
  viewer {
    id
    plan
    usage {
      requestsUsed
      requestsLimit
      creditsUsed
      creditsLimit
      resetAt
    }
  }
}
`;

export function mapWarpUsage(payload: unknown) {
  const requestsUsed = readFirstNumber(payload, ["requestsUsed", "requests_used", "requestCount"]);
  const requestsLimit = readFirstNumber(payload, ["requestsLimit", "requests_limit", "requestLimit"]);
  const creditsUsed = readFirstNumber(payload, ["creditsUsed", "credits_used"]);
  const creditsLimit = readFirstNumber(payload, ["creditsLimit", "credits_limit"]);
  const resetAt = readFirstDate(payload, ["resetAt", "reset_at", "nextResetAt"]);
  const quotas = [];

  if (requestsUsed !== undefined || requestsLimit !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "warp-requests",
        label: "Requests",
        used: requestsUsed,
        total: requestsLimit,
        resetAt,
      }),
    );
  }
  if (creditsUsed !== undefined || creditsLimit !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "warp-credits",
        label: "Credits",
        used: creditsUsed,
        total: creditsLimit,
        unit: "credits",
        resetAt,
      }),
    );
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "warp-readable",
      label: "Warp Usage",
      remainingDisplay: "Warp API returned data, but no known quota fields were present.",
      status: "unknown" as const,
    });
  }
  return quotas;
}

export async function fetchWarpSnapshot(apiKey?: string, apiUrl?: string) {
  const resolvedKey = firstConfiguredSecret("Warp API key", [apiKey, process.env.WARP_API_KEY, process.env.WARP_TOKEN]);
  const endpoint = apiUrl?.trim() || process.env.WARP_GRAPHQL_URL?.trim() || WARP_GRAPHQL_URL;
  const payload = await requestJson<unknown>(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: WARP_USAGE_QUERY }),
    },
    "Warp API key is invalid.",
  );

  return buildSnapshot({
    provider: "warp",
    planLabel: "API",
    quotas: mapWarpUsage(payload),
    endpoint,
    sourceLabel: "Warp GraphQL API",
    rawPayload: payload,
    resetPolicy: "Warp reset timing uses reset fields from the GraphQL usage payload when present.",
  });
}
