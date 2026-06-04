import {
  buildCurrencyQuota,
  buildCountQuota,
  buildSnapshot,
  firstConfiguredSecret,
  readFirstNumber,
  requestJson,
} from "./provider-helpers";

const CLAUDE_ADMIN_DEFAULT_URL = "https://api.anthropic.com/v1/organizations/usage_report/messages";

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveClaudeAdminUrl(manualUrl?: string, now = new Date()): string {
  const base = manualUrl?.trim() || process.env.CLAUDE_ADMIN_USAGE_URL?.trim() || CLAUDE_ADMIN_DEFAULT_URL;
  const url = new URL(base);
  if (!url.searchParams.has("starting_at")) {
    url.searchParams.set("starting_at", isoDateOnly(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)));
  }
  if (!url.searchParams.has("ending_at")) {
    url.searchParams.set("ending_at", isoDateOnly(now));
  }
  return url.toString();
}

export function mapClaudeAdminUsage(payload: unknown) {
  const cost =
    readFirstNumber(payload, ["total_cost", "totalCost", "cost_usd", "costUsd", "amount", "amount_usd"]) ??
    readFirstNumber(payload, ["cost"]);
  const messages = readFirstNumber(payload, ["messages", "message_count", "messageCount", "num_messages"]);
  const inputTokens = readFirstNumber(payload, ["input_tokens", "inputTokens"]);
  const outputTokens = readFirstNumber(payload, ["output_tokens", "outputTokens"]);
  const quotas = [];

  if (cost !== undefined) {
    quotas.push(buildCurrencyQuota({ id: "claude-admin-spend-30d", label: "Admin Spend (30d)", used: cost }));
  }
  if (messages !== undefined) {
    quotas.push(buildCountQuota({ id: "claude-admin-messages-30d", label: "Messages (30d)", used: messages }));
  }
  if (inputTokens !== undefined || outputTokens !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "claude-admin-tokens-30d",
        label: "Tokens (30d)",
        used: (inputTokens ?? 0) + (outputTokens ?? 0),
        unit: "tokens",
      }),
    );
  }

  if (quotas.length === 0) {
    quotas.push({
      id: "claude-admin-readable",
      label: "Admin Usage",
      remainingDisplay: "Admin API returned data, but no known spend/message fields were present.",
      status: "unknown" as const,
    });
  }

  return quotas;
}

export async function fetchClaudeAdminSnapshot(apiKey?: string, usageUrl?: string) {
  const resolvedKey = firstConfiguredSecret("Claude Admin API key", [
    apiKey,
    process.env.ANTHROPIC_ADMIN_KEY,
    process.env.CLAUDE_ADMIN_API_KEY,
  ]);
  const endpoint = resolveClaudeAdminUrl(usageUrl);
  const payload = await requestJson<unknown>(
    endpoint,
    {
      method: "GET",
      headers: {
        "x-api-key": resolvedKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
    },
    "Claude Admin API key is invalid or lacks usage-report access.",
  );

  return buildSnapshot({
    provider: "claude-admin",
    planLabel: "Admin API",
    quotas: mapClaudeAdminUsage(payload),
    endpoint,
    sourceLabel: "Claude Admin API key",
    rawPayload: payload,
    resetPolicy: "Claude Admin usage is reported by the configured usage-report window.",
  });
}
