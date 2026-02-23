export type ProviderId = "codex" | "claude" | "copilot";

export type QuotaStatus = "ok" | "warning" | "critical" | "unknown";

export type SnapshotSource = "api" | "manual";

export interface QuotaItem {
  id: string;
  label: string;
  remainingPercent?: number;
  remainingDisplay: string;
  resetAt?: string;
  trendBadge?: string;
  status: QuotaStatus;
}

export interface ProviderUsageSnapshot {
  provider: ProviderId;
  planLabel?: string;
  fetchedAt: string;
  quotas: QuotaItem[];
  source: SnapshotSource;
  errors?: string[];
}

export interface DashboardState {
  snapshots: ProviderUsageSnapshot[];
  lastRefreshAt?: string;
}
