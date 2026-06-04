import { buildCurrencyQuota, buildSnapshot, firstConfiguredSecret, requestJson } from "./provider-helpers";
import { parseOptionalNumber, safeString } from "../lib/normalize";

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

interface DeepSeekBalanceResponse {
  balance_infos?: Array<{
    currency?: unknown;
    total_balance?: unknown;
    granted_balance?: unknown;
    topped_up_balance?: unknown;
  }>;
  is_available?: unknown;
}

export function mapDeepSeekBalance(payload: DeepSeekBalanceResponse) {
  const balances = payload.balance_infos ?? [];
  const preferred = balances.find((entry) => safeString(entry.currency)?.toUpperCase() === "USD") ?? balances[0];
  if (!preferred) {
    throw new Error("DeepSeek balance response did not include balance_infos.");
  }

  const currency = safeString(preferred.currency)?.toUpperCase() ?? "USD";
  const remaining = parseOptionalNumber(preferred.total_balance);
  const granted = parseOptionalNumber(preferred.granted_balance);
  const toppedUp = parseOptionalNumber(preferred.topped_up_balance);
  return [
    buildCurrencyQuota({
      id: "deepseek-balance",
      label: "Balance",
      remaining,
      currency,
    }),
    ...(granted !== undefined || toppedUp !== undefined
      ? [
          {
            id: "deepseek-balance-breakdown",
            label: "Balance Breakdown",
            remainingDisplay: `Granted ${currency} ${(granted ?? 0).toFixed(2)} | Paid ${currency} ${(toppedUp ?? 0).toFixed(2)}`,
            status: "unknown" as const,
          },
        ]
      : []),
  ];
}

export async function fetchDeepSeekSnapshot(manualApiKey?: string) {
  const apiKey = firstConfiguredSecret("DeepSeek API key", [
    manualApiKey,
    process.env.DEEPSEEK_API_KEY,
    process.env.DEEPSEEK_KEY,
  ]);
  const payload = await requestJson<DeepSeekBalanceResponse>(
    DEEPSEEK_BALANCE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
    "DeepSeek API key is invalid.",
  );

  return buildSnapshot({
    provider: "deepseek",
    planLabel: payload.is_available === false ? "Unavailable" : "API",
    quotas: mapDeepSeekBalance(payload),
    endpoint: DEEPSEEK_BALANCE_URL,
    sourceLabel: "DeepSeek API key",
    rawPayload: payload,
    resetPolicy: "DeepSeek exposes account balance rather than a reset window.",
  });
}
