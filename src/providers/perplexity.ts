import {
  buildCurrencyQuota,
  buildCountQuota,
  buildSnapshot,
  readFirstDate,
  readFirstNumber,
  requestJson,
  resolveCookieCandidates,
} from "./provider-helpers";

type CookieMode = "auto" | "manual";

interface PerplexityOptions {
  cookieHeader?: string;
  sessionToken?: string;
  cookieSourceMode?: CookieMode;
  cachedCookieHeader?: string;
  usageUrl?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

const DEFAULT_ENDPOINTS = [
  "https://www.perplexity.ai/api/rest/billing/subscription",
  "https://www.perplexity.ai/api/rest/billing/usage",
  "https://www.perplexity.ai/api/rest/user/credits",
];

function normalizeMode(value?: string): CookieMode {
  return value?.toLowerCase() === "manual" ? "manual" : "auto";
}

export function mapPerplexityUsage(payload: unknown) {
  const credits =
    readFirstNumber(payload, [
      "credits",
      "available_credits",
      "availableCredits",
      "recurring_credits",
      "recurringCredits",
    ]) ?? readFirstNumber(payload, ["balance"]);
  const total = readFirstNumber(payload, ["monthly_credits", "monthlyCredits", "credit_limit", "creditLimit", "limit"]);
  const used = readFirstNumber(payload, ["used_credits", "usedCredits", "usage", "credits_used"]);
  const renewal = readFirstDate(payload, [
    "renewal_date",
    "renewalDate",
    "next_renewal_at",
    "nextRenewalAt",
    "reset_at",
  ]);
  const quotas = [
    buildCurrencyQuota({
      id: "perplexity-credits",
      label: "Credits",
      remaining: credits,
      total,
      used,
      currency: "credits",
    }),
  ];

  if (used !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "perplexity-used-credits",
        label: "Used Credits",
        used,
        unit: "credits",
        resetAt: renewal,
      }),
    );
  }
  return quotas;
}

async function fetchPerplexityWithCookie(endpoint: string, cookieHeader: string) {
  return requestJson<unknown>(
    endpoint,
    {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
        Accept: "application/json",
        Referer: "https://www.perplexity.ai/settings",
        "User-Agent": "agent-usage-raycast",
      },
    },
    "Perplexity session cookie is invalid or expired.",
  );
}

export async function fetchPerplexitySnapshot(options: PerplexityOptions = {}) {
  const sourceMode = normalizeMode(options.cookieSourceMode);
  const sessionToken = options.sessionToken?.trim() || process.env.PERPLEXITY_SESSION_TOKEN?.trim();
  const cookieDiscovery = await resolveCookieCandidates({
    manual: options.cookieHeader,
    cached: options.cachedCookieHeader,
    env: [process.env.PERPLEXITY_COOKIE, sessionToken ? `pplx.session-token=${sessionToken}` : undefined],
    sourceMode,
    domains: ["perplexity.ai"],
    requiredCookieNames: ["pplx.session-token", "__Secure-next-auth.session-token"],
  });
  if (cookieDiscovery.candidates.length === 0) {
    if (sourceMode === "manual") {
      throw new Error("Perplexity Cookie Source is manual, but no Cookie Header or Session Token is configured.");
    }
    if (cookieDiscovery.hasChromiumV20) {
      throw new Error(
        "Perplexity browser cookies are Chrome app-bound (`v20`). Use Manual mode with a copied Cookie header.",
      );
    }
    throw new Error("No Perplexity session cookie found. Configure a Cookie Header or Session Token.");
  }

  const endpoints = options.usageUrl?.trim() ? [options.usageUrl.trim()] : DEFAULT_ENDPOINTS;
  let lastError: Error | undefined;
  for (const candidate of cookieDiscovery.candidates) {
    for (const endpoint of endpoints) {
      try {
        const payload = await fetchPerplexityWithCookie(endpoint, candidate.header);
        if (options.onCookieResolved) {
          await options.onCookieResolved(candidate.header, candidate.source);
        }
        return buildSnapshot({
          provider: "perplexity",
          planLabel: "Session",
          quotas: mapPerplexityUsage(payload),
          endpoint,
          sourceLabel: `Perplexity session cookie (${candidate.source})`,
          rawPayload: payload,
          resetPolicy: "Perplexity credits use renewal/reset fields when the account endpoint exposes them.",
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  throw lastError ?? new Error("Perplexity usage request failed.");
}
