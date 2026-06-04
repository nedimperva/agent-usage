import {
  buildCurrencyQuota,
  buildSnapshot,
  firstConfiguredSecret,
  readFirstNumber,
  readFirstString,
  requestJson,
} from "./provider-helpers";

const MOONSHOT_ENDPOINTS = {
  global: "https://api.moonshot.ai/v1/users/me/balance",
  cn: "https://api.moonshot.cn/v1/users/me/balance",
};

function resolveMoonshotEndpoint(region?: string, override?: string): string {
  if (override?.trim()) {
    return override.trim().replace(/\/+$/, "");
  }
  return region?.toLowerCase() === "cn" ? MOONSHOT_ENDPOINTS.cn : MOONSHOT_ENDPOINTS.global;
}

export function mapMoonshotBalance(payload: unknown) {
  const available = readFirstNumber(payload, [
    "available_balance",
    "availableBalance",
    "balance",
    "cash_balance",
    "cashBalance",
  ]);
  const granted = readFirstNumber(payload, ["granted_balance", "grantedBalance"]);
  const currency = readFirstString(payload, ["currency", "currency_code", "currencyCode"]) ?? "USD";
  return [
    buildCurrencyQuota({
      id: "moonshot-balance",
      label: "Balance",
      remaining: available,
      currency,
    }),
    ...(granted !== undefined
      ? [
          {
            id: "moonshot-granted-balance",
            label: "Granted Balance",
            remainingDisplay: `${currency} ${granted.toFixed(2)} granted`,
            status: "unknown" as const,
          },
        ]
      : []),
  ];
}

export async function fetchMoonshotSnapshot(apiKey?: string, region?: string, endpointOverride?: string) {
  const resolvedKey = firstConfiguredSecret("Moonshot API key", [
    apiKey,
    process.env.MOONSHOT_API_KEY,
    process.env.MOONSHOT_KEY,
  ]);
  const endpoint = resolveMoonshotEndpoint(
    region ?? process.env.MOONSHOT_REGION,
    endpointOverride ?? process.env.MOONSHOT_BALANCE_URL,
  );
  const payload = await requestJson<unknown>(
    endpoint,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        Accept: "application/json",
      },
    },
    "Moonshot API key is invalid.",
  );

  return buildSnapshot({
    provider: "moonshot",
    planLabel: region?.toLowerCase() === "cn" ? "China" : "Global",
    quotas: mapMoonshotBalance(payload),
    endpoint,
    sourceLabel: "Moonshot/Kimi API key",
    rawPayload: payload,
    resetPolicy: "Moonshot/Kimi API exposes account balance rather than a reset window.",
  });
}
