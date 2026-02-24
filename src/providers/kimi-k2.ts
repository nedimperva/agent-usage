import { ProviderUsageSnapshot } from "../models/usage";
import { parseDateLike, parseOptionalNumber, statusFromRemainingPercent } from "../lib/normalize";

const KIMI_K2_ENDPOINT = "https://kimi-k2.ai/api/user/credits";

function resolveKimiK2ApiKey(manual?: string): string {
  const candidates = [manual?.trim(), process.env.KIMI_K2_API_KEY?.trim(), process.env.KIMI_API_KEY?.trim()];
  for (const candidate of candidates) {
    if (candidate) {
      return candidate.replace(/^Bearer\s+/i, "");
    }
  }
  throw new Error("Kimi K2 API key missing. Set Kimi K2 API Key in preferences.");
}

function collectContexts(root: unknown): Array<Record<string, unknown>> {
  const contexts: Array<Record<string, unknown>> = [];

  const pushIfObject = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      contexts.push(value as Record<string, unknown>);
    }
  };

  pushIfObject(root);
  const record = root && typeof root === "object" ? (root as Record<string, unknown>) : undefined;
  if (!record) {
    return contexts;
  }

  pushIfObject(record.data);
  pushIfObject(record.result);
  pushIfObject(record.usage);
  pushIfObject(record.credits);

  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : undefined;
  if (data) {
    pushIfObject(data.usage);
    pushIfObject(data.credits);
  }

  const result =
    record.result && typeof record.result === "object" ? (record.result as Record<string, unknown>) : undefined;
  if (result) {
    pushIfObject(result.usage);
    pushIfObject(result.credits);
  }

  return contexts;
}

function readNumber(paths: string[][], contexts: Array<Record<string, unknown>>): number | undefined {
  for (const path of paths) {
    for (const context of contexts) {
      let cursor: unknown = context;
      for (const key of path) {
        if (!cursor || typeof cursor !== "object") {
          cursor = undefined;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      const parsed = parseOptionalNumber(cursor);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

function readTimestamp(contexts: Array<Record<string, unknown>>): string | undefined {
  const paths = [["updated_at"], ["updatedAt"], ["timestamp"], ["time"], ["last_update"], ["lastUpdated"]];
  for (const path of paths) {
    for (const context of contexts) {
      let cursor: unknown = context;
      for (const key of path) {
        if (!cursor || typeof cursor !== "object") {
          cursor = undefined;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      const parsed = parseDateLike(cursor);
      if (parsed) {
        return parsed;
      }
    }
  }
  return undefined;
}

export async function fetchKimiK2Snapshot(manualApiKey?: string): Promise<ProviderUsageSnapshot> {
  const apiKey = resolveKimiK2ApiKey(manualApiKey);
  const response = await fetch(KIMI_K2_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Kimi K2 API key is invalid.");
    }
    const body = await response.text();
    throw new Error(`Kimi K2 API ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = (await response.json()) as unknown;
  const contexts = collectContexts(payload);
  const consumed = readNumber(
    [
      ["total_credits_consumed"],
      ["totalCreditsConsumed"],
      ["total_credits_used"],
      ["totalCreditsUsed"],
      ["credits_consumed"],
      ["creditsConsumed"],
      ["consumedCredits"],
      ["usedCredits"],
      ["usage", "total"],
      ["usage", "consumed"],
      ["total"],
    ],
    contexts,
  );
  const remaining = readNumber(
    [
      ["credits_remaining"],
      ["creditsRemaining"],
      ["remaining_credits"],
      ["remainingCredits"],
      ["available_credits"],
      ["availableCredits"],
      ["credits_left"],
      ["creditsLeft"],
      ["usage", "credits_remaining"],
      ["usage", "remaining"],
    ],
    contexts,
  );
  const averageTokens = readNumber(
    [
      ["average_tokens_per_request"],
      ["averageTokensPerRequest"],
      ["average_tokens"],
      ["averageTokens"],
      ["avg_tokens"],
      ["avgTokens"],
    ],
    contexts,
  );

  const total = Math.max(0, (consumed ?? 0) + (remaining ?? 0));
  const remainingValue = Math.max(0, remaining ?? 0);
  const remainingPercent = total > 0 ? Math.max(0, Math.min(100, (remainingValue / total) * 100)) : undefined;
  const updatedAt = readTimestamp(contexts) ?? new Date().toISOString();

  return {
    provider: "kimi-k2",
    planLabel: "API Key",
    fetchedAt: updatedAt,
    quotas: [
      {
        id: "kimi-k2-credits",
        label: "Credits",
        remainingPercent,
        remainingDisplay:
          total > 0
            ? `${remainingValue.toFixed(0)} left of ${total.toFixed(0)}`
            : `${remainingValue.toFixed(0)} remaining`,
        status: statusFromRemainingPercent(remainingPercent),
      },
    ],
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: "Kimi K2 API key" },
          { label: "Endpoint", value: KIMI_K2_ENDPOINT },
          { label: "Average tokens/request", value: averageTokens !== undefined ? averageTokens.toFixed(2) : "n/a" },
        ],
      },
    ],
    rawPayload: payload,
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Credits are cumulative from Kimi K2 usage endpoint.",
  };
}
