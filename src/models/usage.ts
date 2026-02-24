export type ProviderId = "codex" | "claude" | "copilot" | "cursor" | "gemini" | "antigravity";

export type QuotaStatus = "ok" | "warning" | "critical" | "unknown";

export type SnapshotSource = "api" | "manual";

export interface SnapshotSectionItem {
  label: string;
  value: string;
  subtitle?: string;
}

export interface SnapshotSection {
  id: string;
  title: string;
  items: SnapshotSectionItem[];
}

export interface QuotaHistoryPoint {
  at: string;
  remainingPercent: number;
}

export interface QuotaHistorySeries {
  quotaId: string;
  points: QuotaHistoryPoint[];
}

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
  highlights?: string[];
  source: SnapshotSource;
  errors?: string[];
  metadataSections?: SnapshotSection[];
  quotaHistory?: QuotaHistorySeries[];
  rawPayload?: unknown;
  staleAfterSeconds?: number;
  resetPolicy?: string;
}

export interface DashboardState {
  snapshots: ProviderUsageSnapshot[];
  lastRefreshAt?: string;
}
