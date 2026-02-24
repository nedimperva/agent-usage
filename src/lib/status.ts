import { ProviderId } from "../models/usage";

export type ProviderStatusLevel = "operational" | "degraded" | "outage" | "unknown";

export interface ProviderStatusSnapshot {
  provider: ProviderId;
  level: ProviderStatusLevel;
  indicator: string;
  summary: string;
  endpoint: string;
  checkedAt: string;
}

const STATUSPAGE_ENDPOINTS: Partial<Record<ProviderId, string>> = {
  codex: "https://status.openai.com/api/v2/status.json",
  claude: "https://status.anthropic.com/api/v2/status.json",
  cursor: "https://status.cursor.com/api/v2/status.json",
  copilot: "https://www.githubstatus.com/api/v2/status.json",
  openrouter: "https://status.openrouter.ai/api/v2/status.json",
};

interface StatusPageResponse {
  status?: {
    indicator?: unknown;
    description?: unknown;
  };
}

function mapIndicatorToLevel(indicator: string): ProviderStatusLevel {
  const normalized = indicator.toLowerCase();
  if (normalized === "none") {
    return "operational";
  }
  if (normalized === "minor") {
    return "degraded";
  }
  if (normalized === "major" || normalized === "critical") {
    return "outage";
  }
  return "unknown";
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function withTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export function statusEndpointForProvider(provider: ProviderId): string | undefined {
  return STATUSPAGE_ENDPOINTS[provider];
}

export async function fetchProviderStatus(provider: ProviderId): Promise<ProviderStatusSnapshot | undefined> {
  const endpoint = statusEndpointForProvider(provider);
  if (!endpoint) {
    return undefined;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: withTimeoutSignal(4000),
    });

    if (!response.ok) {
      return {
        provider,
        level: "unknown",
        indicator: "unknown",
        summary: `Status endpoint HTTP ${response.status}`,
        endpoint,
        checkedAt: new Date().toISOString(),
      };
    }

    const payload = (await response.json()) as StatusPageResponse;
    const indicator = safeString(payload.status?.indicator) ?? "unknown";
    const summary = safeString(payload.status?.description) ?? "Unknown service state";
    return {
      provider,
      level: mapIndicatorToLevel(indicator),
      indicator,
      summary,
      endpoint,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      provider,
      level: "unknown",
      indicator: "unknown",
      summary: "Status check failed",
      endpoint,
      checkedAt: new Date().toISOString(),
    };
  }
}
