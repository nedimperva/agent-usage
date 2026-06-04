export type ProviderId =
  | "codex"
  | "openai"
  | "claude"
  | "claude-admin"
  | "copilot"
  | "cursor"
  | "gemini"
  | "antigravity"
  | "openrouter"
  | "zai"
  | "deepseek"
  | "moonshot"
  | "mistral"
  | "perplexity"
  | "grok"
  | "groqcloud"
  | "windsurf"
  | "augment"
  | "kiro"
  | "warp"
  | "zed"
  | "kimi-k2"
  | "amp"
  | "minimax"
  | "opencode"
  | "opencode-go";

export type QuotaStatus = "ok" | "warning" | "critical" | "unknown";

export type SnapshotSource = "api" | "manual";
export type QuotaSampleSource = "manual" | "background";
export type QuotaPaceStatus = "on-pace" | "deficit" | "surplus" | "unknown";
export type QuotaForecastConfidence = "low" | "medium" | "high";

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
  resetAt?: string;
  sampleSource?: QuotaSampleSource;
}

export interface QuotaHistorySeries {
  quotaId: string;
  points: QuotaHistoryPoint[];
}

export interface QuotaForecast {
  paceStatus: QuotaPaceStatus;
  confidence?: QuotaForecastConfidence;
  estimatedRunoutAt?: string;
  projectedRemainingAtReset?: number;
  deficitPercent?: number;
  surplusPercent?: number;
  sampleCount: number;
  hiddenReason?: string;
  lastSampleAt?: string;
}

export interface QuotaItem {
  id: string;
  label: string;
  remainingPercent?: number;
  remainingDisplay: string;
  resetAt?: string;
  windowStartAt?: string;
  windowDurationSeconds?: number;
  forecast?: QuotaForecast;
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

export interface SamplerStatusReport {
  lastSampleAt?: string;
  sampledProviders: ProviderId[];
  failedProviders: ProviderId[];
  failureMessages: Partial<Record<ProviderId, string>>;
  skippedProviders?: ProviderId[];
  skipMessages?: Partial<Record<ProviderId, string>>;
}
