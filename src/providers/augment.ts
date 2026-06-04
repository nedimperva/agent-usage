import {
  buildCountQuota,
  buildSnapshot,
  firstConfiguredOptional,
  parseJsonObjectFromText,
  readFirstDate,
  readFirstNumber,
  readFirstString,
  requestJson,
  resolveCookieCandidates,
  runCommandText,
} from "./provider-helpers";

type CookieMode = "auto" | "manual";

interface AugmentOptions {
  apiKey?: string;
  cookieHeader?: string;
  cookieSourceMode?: CookieMode;
  cachedCookieHeader?: string;
  usageUrl?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

const DEFAULT_ENDPOINTS = ["https://app.augmentcode.com/api/usage", "https://app.augmentcode.com/api/billing/usage"];

function normalizeMode(value?: string): CookieMode {
  return value?.toLowerCase() === "manual" ? "manual" : "auto";
}

export function mapAugmentUsage(payload: unknown, fallbackText?: string) {
  const creditsUsed = readFirstNumber(payload, ["creditsUsed", "credits_used", "usedCredits", "used"]);
  const creditsLimit = readFirstNumber(payload, ["creditsLimit", "credits_limit", "totalCredits", "limit"]);
  const creditsRemaining = readFirstNumber(payload, [
    "creditsRemaining",
    "credits_remaining",
    "remainingCredits",
    "remaining",
  ]);
  const resetAt = readFirstDate(payload, ["resetAt", "reset_at", "renewAt", "renew_at"]);
  const quotas = [];

  if (creditsUsed !== undefined || creditsLimit !== undefined || creditsRemaining !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "augment-credits",
        label: "Credits",
        used: creditsUsed,
        total: creditsLimit,
        remaining: creditsRemaining,
        unit: "credits",
        resetAt,
      }),
    );
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "augment-readable",
      label: "Augment Usage",
      remainingDisplay:
        fallbackText?.trim().slice(0, 180) || "Augment returned data, but no known credit fields were present.",
      status: "unknown" as const,
    });
  }
  return quotas;
}

async function tryAugmentCli() {
  const binary = process.env.AUGMENT_CLI_PATH?.trim() || "auggie";
  const text = await runCommandText(binary, ["usage", "--json"], 10000);
  return { binary, text, payload: parseJsonObjectFromText(text) };
}

export async function fetchAugmentSnapshot(options: AugmentOptions = {}) {
  try {
    const cli = await tryAugmentCli();
    return buildSnapshot({
      provider: "augment",
      planLabel: readFirstString(cli.payload, ["plan", "planName", "subscription"]) ?? "CLI",
      quotas: mapAugmentUsage(cli.payload, cli.text),
      endpoint: `${cli.binary} usage --json`,
      sourceLabel: "Augment CLI",
      rawPayload: cli.payload ?? { output: cli.text },
      resetPolicy: "Augment usage is parsed from CLI or account API credit fields.",
    });
  } catch {
    // Fall back to configured API/cookie sources.
  }

  const apiKey = firstConfiguredOptional([options.apiKey, process.env.AUGMENT_API_KEY]);
  const endpoints = options.usageUrl?.trim() ? [options.usageUrl.trim()] : DEFAULT_ENDPOINTS;
  if (apiKey) {
    const endpoint = endpoints[0];
    const payload = await requestJson<unknown>(
      endpoint,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
          Accept: "application/json",
        },
      },
      "Augment API key is invalid.",
    );
    return buildSnapshot({
      provider: "augment",
      planLabel: "API",
      quotas: mapAugmentUsage(payload),
      endpoint,
      sourceLabel: "Augment API key",
      rawPayload: payload,
      resetPolicy: "Augment usage is parsed from CLI or account API credit fields.",
    });
  }

  const sourceMode = normalizeMode(options.cookieSourceMode);
  const resolved = await resolveCookieCandidates({
    manual: options.cookieHeader,
    cached: options.cachedCookieHeader,
    env: [process.env.AUGMENT_COOKIE_HEADER, process.env.AUGMENT_COOKIE],
    sourceMode,
    domains: ["augmentcode.com"],
  });
  if (resolved.candidates.length === 0) {
    throw new Error("No Augment CLI/API/cookie source found. Run `auggie login`, set API key, or configure cookies.");
  }

  let lastError: Error | undefined;
  for (const candidate of resolved.candidates) {
    for (const endpoint of endpoints) {
      try {
        const payload = await requestJson<unknown>(
          endpoint,
          {
            method: "GET",
            headers: {
              Cookie: candidate.header,
              Accept: "application/json",
              Referer: "https://app.augmentcode.com/account",
            },
          },
          "Augment session cookie is invalid or expired.",
        );
        if (options.onCookieResolved) {
          await options.onCookieResolved(candidate.header, candidate.source);
        }
        return buildSnapshot({
          provider: "augment",
          planLabel: "Session",
          quotas: mapAugmentUsage(payload),
          endpoint,
          sourceLabel: `Augment session cookie (${candidate.source})`,
          rawPayload: payload,
          resetPolicy: "Augment usage is parsed from CLI or account API credit fields.",
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  throw lastError ?? new Error("Augment usage request failed.");
}
