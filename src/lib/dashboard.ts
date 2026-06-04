import { ProviderId, ProviderUsageSnapshot, QuotaStatus } from "../models/usage";
import { formatRelativeTimestamp } from "./date";
import { formatCompactForecastHint } from "./forecast";
import { CORE_PROVIDERS, OPTIONAL_PROVIDERS, PROVIDER_ORDER, providerTitle } from "./provider-registry";

export { CORE_PROVIDERS, OPTIONAL_PROVIDERS, PROVIDER_ORDER };

export interface ProviderRowSummary {
  provider: ProviderId;
  title: string;
  subtitle: string;
  status: QuotaStatus;
}

export type SnapshotMap = Partial<Record<ProviderId, ProviderUsageSnapshot>>;

export type ProviderSnapshotFetcher = (provider: ProviderId) => Promise<ProviderUsageSnapshot>;

export type FallbackSnapshotBuilder = (provider: ProviderId, error: unknown) => ProviderUsageSnapshot;

export interface RefreshSingleProviderResult {
  snapshots: SnapshotMap;
  snapshot: ProviderUsageSnapshot;
  refreshedAt: string;
  failed: boolean;
  failureMessage?: string;
}

export interface RefreshAllProvidersResult {
  snapshots: SnapshotMap;
  refreshedAt: string;
  failedProviders: ProviderId[];
  failureMessages: Partial<Record<ProviderId, string>>;
}

function statusRank(status: QuotaStatus): number {
  if (status === "critical") {
    return 4;
  }
  if (status === "warning") {
    return 3;
  }
  if (status === "ok") {
    return 2;
  }
  return 1;
}

function quotaSummaryText(snapshot: ProviderUsageSnapshot): string {
  if (snapshot.quotas.length === 0) {
    return "No limits available";
  }

  let primary = snapshot.quotas[0];
  for (const quota of snapshot.quotas) {
    if (statusRank(quota.status) > statusRank(primary.status)) {
      primary = quota;
    }
  }

  if (primary.remainingPercent !== undefined && Number.isFinite(primary.remainingPercent)) {
    const rounded = Math.round(primary.remainingPercent * 10) / 10;
    const percentText = Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
    return `${primary.label}: ${percentText}`;
  }

  return `${primary.label}: ${primary.remainingDisplay}`;
}

export function isUnavailableSnapshot(snapshot: ProviderUsageSnapshot): boolean {
  return snapshot.quotas.some((quota) => quota.label === "Unavailable");
}

export function summarizeProviderSnapshot(snapshot: ProviderUsageSnapshot, now = new Date()): ProviderRowSummary {
  const title = snapshot.planLabel
    ? `${providerTitle(snapshot.provider)} (${snapshot.planLabel})`
    : providerTitle(snapshot.provider);
  const updatedText = `Updated ${formatRelativeTimestamp(snapshot.fetchedAt, now.getTime())}`;
  const limitsText = quotaSummaryText(snapshot);
  const forecastText = formatCompactForecastHint(snapshot, now);
  const highlightsText = snapshot.highlights?.find((entry) => entry.trim().length > 0);

  if (isUnavailableSnapshot(snapshot)) {
    const reason = snapshot.quotas.find((quota) => quota.label === "Unavailable")?.remainingDisplay;
    return {
      provider: snapshot.provider,
      title,
      status: "warning",
      subtitle: reason ? `${reason} ${updatedText}.` : `Usage unavailable. ${updatedText}.`,
    };
  }

  let status: QuotaStatus = "unknown";

  for (const quota of snapshot.quotas) {
    if (statusRank(quota.status) > statusRank(status)) {
      status = quota.status;
    }
  }

  return {
    provider: snapshot.provider,
    title,
    subtitle: `${[
      limitsText,
      snapshot.quotas.length > 1 ? `+${snapshot.quotas.length - 1} more` : undefined,
      forecastText,
      highlightsText,
    ]
      .filter((part): part is string => !!part)
      .join(" | ")}. ${updatedText}.`,
    status,
  };
}

export async function refreshSingleProvider(
  current: SnapshotMap,
  provider: ProviderId,
  fetchSnapshot: ProviderSnapshotFetcher,
  fallbackSnapshot: FallbackSnapshotBuilder,
  now = new Date(),
): Promise<RefreshSingleProviderResult> {
  let failed = false;
  let snapshot: ProviderUsageSnapshot;
  let failureMessage: string | undefined;

  try {
    snapshot = await fetchSnapshot(provider);
  } catch (error) {
    snapshot = fallbackSnapshot(provider, error);
    failed = true;
    failureMessage = error instanceof Error ? error.message : String(error);
  }

  return {
    snapshots: { ...current, [provider]: snapshot },
    snapshot,
    refreshedAt: now.toISOString(),
    failed,
    failureMessage,
  };
}

export async function refreshAllProviders(
  current: SnapshotMap,
  fetchSnapshot: ProviderSnapshotFetcher,
  fallbackSnapshot: FallbackSnapshotBuilder,
  now = new Date(),
  providerOrder: ProviderId[] = PROVIDER_ORDER,
): Promise<RefreshAllProvidersResult> {
  const next: SnapshotMap = { ...current };
  const failedProviders: ProviderId[] = [];
  const failureMessages: Partial<Record<ProviderId, string>> = {};

  for (const provider of providerOrder) {
    try {
      next[provider] = await fetchSnapshot(provider);
    } catch (error) {
      next[provider] = fallbackSnapshot(provider, error);
      failedProviders.push(provider);
      failureMessages[provider] = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    snapshots: next,
    refreshedAt: now.toISOString(),
    failedProviders,
    failureMessages,
  };
}
