import { PROVIDER_ORDER, SnapshotMap } from "./dashboard";
import { attachForecasts } from "./forecast";
import { mergeQuotaHistory } from "./history";
import { ProviderId, ProviderUsageSnapshot, QuotaSampleSource } from "../models/usage";

function orderedSnapshots(map: SnapshotMap): ProviderUsageSnapshot[] {
  return PROVIDER_ORDER.map((providerId) => map[providerId]).filter(
    (snapshot): snapshot is ProviderUsageSnapshot => !!snapshot,
  );
}

export function attachForecastsToSnapshotMap(snapshots: SnapshotMap, now = new Date()): SnapshotMap {
  const next: SnapshotMap = {};
  for (const [providerId, snapshot] of Object.entries(snapshots) as Array<
    [ProviderId, ProviderUsageSnapshot | undefined]
  >) {
    if (!snapshot) {
      continue;
    }
    next[providerId] = attachForecasts(snapshot, now);
  }
  return next;
}

export function mergeDerivedSnapshot(
  previous: ProviderUsageSnapshot | undefined,
  next: ProviderUsageSnapshot,
  observedAt: string,
  sampleSource: QuotaSampleSource,
  now = new Date(),
): ProviderUsageSnapshot {
  return attachForecasts(
    {
      ...next,
      quotaHistory: mergeQuotaHistory(previous, next, observedAt, sampleSource),
    },
    now,
  );
}

export function mergeDerivedSnapshotMap(
  previous: SnapshotMap,
  next: SnapshotMap,
  providerOrder: ProviderId[],
  observedAt: string,
  sampleSource: QuotaSampleSource,
  now = new Date(),
): SnapshotMap {
  const merged: SnapshotMap = { ...next };
  for (const providerId of providerOrder) {
    const candidate = next[providerId];
    if (!candidate) {
      continue;
    }
    merged[providerId] = mergeDerivedSnapshot(previous[providerId], candidate, observedAt, sampleSource, now);
  }
  return merged;
}

export async function persistSnapshotMap(snapshots: SnapshotMap, refreshAt?: string): Promise<void> {
  const { saveDashboardState } = await import("./storage");
  await saveDashboardState({
    snapshots: orderedSnapshots(snapshots),
    lastRefreshAt: refreshAt,
  });
}
