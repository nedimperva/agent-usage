import { LocalStorage } from "@raycast/api";
import { DashboardState, ProviderId, ProviderUsageSnapshot, SamplerStatusReport } from "../models/usage";

const DASHBOARD_STATE_KEY = "agent-usage.dashboard-state.v1";
const SAMPLER_STATUS_KEY = "agent-usage.sampler-status.v1";

export async function loadDashboardState(): Promise<DashboardState | undefined> {
  const raw = await LocalStorage.getItem<string>(DASHBOARD_STATE_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as DashboardState;
  } catch {
    return undefined;
  }
}

export async function saveDashboardState(state: DashboardState): Promise<void> {
  await LocalStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify(state));
}

export async function loadSamplerStatus(): Promise<SamplerStatusReport | undefined> {
  const raw = await LocalStorage.getItem<string>(SAMPLER_STATUS_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as SamplerStatusReport;
  } catch {
    return undefined;
  }
}

export async function saveSamplerStatus(report: SamplerStatusReport): Promise<void> {
  await LocalStorage.setItem(SAMPLER_STATUS_KEY, JSON.stringify(report));
}

export function mapSnapshotsByProvider(
  snapshots: ProviderUsageSnapshot[],
): Partial<Record<ProviderId, ProviderUsageSnapshot>> {
  return snapshots.reduce<Partial<Record<ProviderId, ProviderUsageSnapshot>>>((acc, snapshot) => {
    acc[snapshot.provider] = snapshot;
    return acc;
  }, {});
}
