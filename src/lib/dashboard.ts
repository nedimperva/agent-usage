import { ProviderId, ProviderUsageSnapshot, QuotaStatus } from "../models/usage";
import { formatRelativeTimestamp } from "./date";

export const PROVIDER_ORDER: ProviderId[] = ["codex", "cursor", "copilot", "claude"];

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
}

export interface RefreshAllProvidersResult {
  snapshots: SnapshotMap;
  refreshedAt: string;
  failedProviders: ProviderId[];
}

function providerTitle(provider: ProviderId): string {
  if (provider === "codex") {
    return "Codex";
  }

  if (provider === "claude") {
    return "Claude";
  }

  if (provider === "cursor") {
    return "Cursor";
  }

  return "GitHub Copilot";
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

  const primary = snapshot.quotas.slice(0, 2);
  const summaries = primary.map((quota) => {
    if (quota.remainingPercent !== undefined && Number.isFinite(quota.remainingPercent)) {
      const rounded = Math.round(quota.remainingPercent * 10) / 10;
      const percentText = Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
      return `${quota.label}: ${percentText}`;
    }

    return `${quota.label}: ${quota.remainingDisplay}`;
  });

  const extraCount = snapshot.quotas.length - primary.length;
  if (extraCount > 0) {
    summaries.push(`+${extraCount} more`);
  }

  return summaries.join(", ");
}

export function isUnavailableSnapshot(snapshot: ProviderUsageSnapshot): boolean {
  return snapshot.source === "manual" && snapshot.quotas.some((quota) => quota.label === "Unavailable");
}

export function summarizeProviderSnapshot(snapshot: ProviderUsageSnapshot, now = new Date()): ProviderRowSummary {
  const title = snapshot.planLabel
    ? `${providerTitle(snapshot.provider)} (${snapshot.planLabel})`
    : providerTitle(snapshot.provider);
  const updatedText = `Updated ${formatRelativeTimestamp(snapshot.fetchedAt, now.getTime())}`;
  const limitsText = quotaSummaryText(snapshot);
  const highlightsText = snapshot.highlights?.filter((entry) => entry.trim().length > 0).join(" | ");

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
    subtitle: highlightsText ? `${highlightsText}. ${limitsText}. ${updatedText}.` : `${limitsText}. ${updatedText}.`,
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

  try {
    snapshot = await fetchSnapshot(provider);
  } catch (error) {
    snapshot = fallbackSnapshot(provider, error);
    failed = true;
  }

  return {
    snapshots: { ...current, [provider]: snapshot },
    snapshot,
    refreshedAt: now.toISOString(),
    failed,
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

  for (const provider of providerOrder) {
    try {
      next[provider] = await fetchSnapshot(provider);
    } catch (error) {
      next[provider] = fallbackSnapshot(provider, error);
      failedProviders.push(provider);
    }
  }

  return {
    snapshots: next,
    refreshedAt: now.toISOString(),
    failedProviders,
  };
}
