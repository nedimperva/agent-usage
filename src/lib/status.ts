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
  openai: "https://status.openai.com/api/v2/status.json",
  claude: "https://status.anthropic.com/api/v2/status.json",
  "claude-admin": "https://status.anthropic.com/api/v2/status.json",
  cursor: "https://status.cursor.com/api/v2/status.json",
  copilot: "https://www.githubstatus.com/api/v2/status.json",
  openrouter: "https://status.openrouter.ai/api/v2/status.json",
  mistral: "https://status.mistral.ai/api/v2/status.json",
  perplexity: "https://status.perplexity.com/api/v2/status.json",
  zed: "https://status.zed.dev/summary.json",
};

interface StatusPageResponse {
  status?: {
    indicator?: unknown;
    description?: unknown;
  };
}

interface InstatusSummaryResponse {
  page?: {
    status?: unknown;
  };
  activeIncidents?: Array<{
    name?: unknown;
    status?: unknown;
    impact?: unknown;
  }>;
  activeMaintenances?: Array<{
    name?: unknown;
    status?: unknown;
  }>;
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

function mapInstatusPageStatus(status: string): ProviderStatusLevel {
  const normalized = status.toUpperCase();
  if (normalized === "UP") {
    return "operational";
  }
  if (normalized === "HASISSUES" || normalized === "UNDERMAINTENANCE") {
    return "degraded";
  }
  if (normalized === "DOWN") {
    return "outage";
  }
  return "unknown";
}

function mapInstatusImpactToLevel(impact: string): ProviderStatusLevel {
  const normalized = impact.toUpperCase();
  if (normalized === "MINOR" || normalized === "MINOROUTAGE" || normalized === "MAINTENANCE") {
    return "degraded";
  }
  if (normalized === "MAJOR" || normalized === "MAJOROUTAGE" || normalized === "CRITICAL") {
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

function parseStatusResponse(
  provider: ProviderId,
  endpoint: string,
  payload: unknown,
  checkedAt: string,
): ProviderStatusSnapshot {
  const statusPagePayload = payload as StatusPageResponse;
  const indicator = safeString(statusPagePayload.status?.indicator);
  if (indicator) {
    const summary = safeString(statusPagePayload.status?.description) ?? "Unknown service state";
    return {
      provider,
      level: mapIndicatorToLevel(indicator),
      indicator,
      summary,
      endpoint,
      checkedAt,
    };
  }

  const instatusPayload = payload as InstatusSummaryResponse;
  const pageStatus = safeString(instatusPayload.page?.status);
  if (
    pageStatus ||
    Array.isArray(instatusPayload.activeIncidents) ||
    Array.isArray(instatusPayload.activeMaintenances)
  ) {
    const incidents = Array.isArray(instatusPayload.activeIncidents) ? instatusPayload.activeIncidents : [];
    const incidentSummary = incidents
      .map((incident) => {
        const name = safeString(incident.name);
        const status = safeString(incident.status);
        if (name && status) {
          return `${name} (${status})`;
        }
        return name || status;
      })
      .filter((value): value is string => !!value)
      .join("; ");
    const incidentLevels = incidents
      .map((incident) => mapInstatusImpactToLevel(safeString(incident.impact) ?? ""))
      .filter((level) => level !== "unknown");
    const maintenanceNames = (
      Array.isArray(instatusPayload.activeMaintenances) ? instatusPayload.activeMaintenances : []
    )
      .map((maintenance) => safeString(maintenance.name))
      .filter((value): value is string => !!value)
      .join("; ");
    const level = incidentLevels.includes("outage")
      ? "outage"
      : incidentLevels.includes("degraded")
        ? "degraded"
        : mapInstatusPageStatus(pageStatus ?? "");
    const summary =
      incidentSummary ||
      (maintenanceNames ? `Maintenance: ${maintenanceNames}` : undefined) ||
      pageStatus ||
      "Unknown service state";
    return {
      provider,
      level,
      indicator: (pageStatus ?? "unknown").toLowerCase(),
      summary,
      endpoint,
      checkedAt,
    };
  }

  return {
    provider,
    level: "unknown",
    indicator: "unknown",
    summary: "Unknown service state",
    endpoint,
    checkedAt,
  };
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

    const checkedAt = new Date().toISOString();
    const payload = (await response.json()) as unknown;
    return parseStatusResponse(provider, endpoint, payload, checkedAt);
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
