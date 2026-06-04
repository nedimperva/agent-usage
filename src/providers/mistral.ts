import {
  buildCurrencyQuota,
  buildCountQuota,
  buildSnapshot,
  normalizeCookieHeader,
  readFirstNumber,
  requestJson,
  resolveCookieCandidates,
} from "./provider-helpers";

type CookieMode = "auto" | "manual";

interface MistralOptions {
  cookieHeader?: string;
  cookieSourceMode?: CookieMode;
  cachedCookieHeader?: string;
  usageUrl?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

const DEFAULT_ENDPOINTS = [
  "https://admin.mistral.ai/api/billing/usage",
  "https://admin.mistral.ai/api/usage",
  "https://admin.mistral.ai/api/workspaces/current/billing/usage",
];

function normalizeMode(value?: string): CookieMode {
  return value?.toLowerCase() === "manual" ? "manual" : "auto";
}

function csrfFromCookie(cookieHeader: string): string | undefined {
  const normalized = normalizeCookieHeader(cookieHeader);
  const match = normalized.match(/(?:^|;\s*)csrftoken=([^;]+)/i);
  return match?.[1];
}

export function mapMistralUsage(payload: unknown) {
  const spend = readFirstNumber(payload, ["total_cost", "totalCost", "cost", "cost_usd", "amount"]);
  const inputTokens = readFirstNumber(payload, ["input_tokens", "inputTokens", "prompt_tokens"]);
  const outputTokens = readFirstNumber(payload, ["output_tokens", "outputTokens", "completion_tokens"]);
  const requests = readFirstNumber(payload, ["requests", "request_count", "num_requests"]);
  const quotas = [];

  if (spend !== undefined) {
    quotas.push(buildCurrencyQuota({ id: "mistral-monthly-spend", label: "Monthly Spend", used: spend }));
  }
  if (inputTokens !== undefined || outputTokens !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "mistral-monthly-tokens",
        label: "Tokens",
        used: (inputTokens ?? 0) + (outputTokens ?? 0),
        unit: "tokens",
      }),
    );
  }
  if (requests !== undefined) {
    quotas.push(buildCountQuota({ id: "mistral-monthly-requests", label: "Requests", used: requests }));
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "mistral-readable",
      label: "Billing Usage",
      remainingDisplay: "Billing endpoint returned data, but no known usage fields were present.",
      status: "unknown" as const,
    });
  }

  return quotas;
}

async function fetchMistralJson(endpoint: string, cookieHeader: string) {
  const csrf = csrfFromCookie(cookieHeader);
  return requestJson<unknown>(
    endpoint,
    {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        Accept: "application/json",
        Referer: "https://admin.mistral.ai/billing",
        ...(csrf ? { "X-CSRFTOKEN": csrf } : {}),
      },
    },
    "Mistral session cookie is invalid or expired.",
  );
}

export async function fetchMistralSnapshot(options: MistralOptions = {}) {
  const sourceMode = normalizeMode(options.cookieSourceMode);
  const resolved = await resolveCookieCandidates({
    manual: options.cookieHeader,
    cached: options.cachedCookieHeader,
    env: [process.env.MISTRAL_COOKIE_HEADER, process.env.MISTRAL_COOKIE],
    sourceMode,
    domains: ["admin.mistral.ai"],
    requiredCookieNames: ["ory_session", "csrftoken"],
  });
  if (resolved.candidates.length === 0) {
    if (sourceMode === "manual") {
      throw new Error("Mistral Cookie Source is manual, but no Mistral Cookie Header is configured.");
    }
    if (resolved.hasChromiumV20) {
      throw new Error(
        "Mistral browser cookies are Chrome app-bound (`v20`). Use Manual mode with a copied Cookie header.",
      );
    }
    throw new Error(
      "No Mistral session cookie found. Configure a Cookie Header or use Auto with an authenticated browser.",
    );
  }

  const endpoints = options.usageUrl?.trim() ? [options.usageUrl.trim()] : DEFAULT_ENDPOINTS;
  let lastError: Error | undefined;
  for (const candidate of resolved.candidates) {
    for (const endpoint of endpoints) {
      try {
        const payload = await fetchMistralJson(endpoint, candidate.header);
        if (options.onCookieResolved) {
          await options.onCookieResolved(candidate.header, candidate.source);
        }
        return buildSnapshot({
          provider: "mistral",
          planLabel: "Console",
          quotas: mapMistralUsage(payload),
          endpoint,
          sourceLabel: `Mistral console cookie (${candidate.source})`,
          rawPayload: payload,
          resetPolicy: "Mistral console billing is treated as a monthly account spend window.",
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  throw lastError ?? new Error("Mistral usage request failed.");
}
