import { ProviderId, ProviderUsageSnapshot } from "../models/usage";
import {
  CORE_PROVIDERS,
  OPTIONAL_PROVIDERS,
  PROVIDER_ORDER,
  SnapshotMap,
  isUnavailableSnapshot,
  summarizeProviderSnapshot,
} from "./dashboard";
import { providerShouldAutoShow } from "./provider-registry";

export interface MainScreenProviderPreferences {
  openaiAdminApiKey?: string;
  openaiApiKey?: string;
  claudeAdminApiKey?: string;
  openrouterApiKey?: string;
  zaiApiKey?: string;
  deepseekApiKey?: string;
  moonshotApiKey?: string;
  mistralCookieHeader?: string;
  perplexityCookieHeader?: string;
  perplexitySessionToken?: string;
  grokCookieHeader?: string;
  groqcloudApiKey?: string;
  windsurfCookieHeader?: string;
  augmentApiKey?: string;
  augmentCookieHeader?: string;
  kiroCliPath?: string;
  warpApiKey?: string;
  zedCookieHeader?: string;
  kimiK2ApiKey?: string;
  ampCookieHeader?: string;
  minimaxApiKey?: string;
  minimaxCookieHeader?: string;
  opencodeCookieHeader?: string;
}

function normalizeProviderSelection(providers: ProviderId[]): ProviderId[] {
  const selected = new Set(providers);
  return PROVIDER_ORDER.filter((provider) => selected.has(provider));
}

export function parseMainScreenProviders(raw: string | undefined): ProviderId[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeProviderSelection(
      parsed.filter(
        (entry): entry is ProviderId => typeof entry === "string" && PROVIDER_ORDER.includes(entry as ProviderId),
      ),
    );
  } catch {
    return [];
  }
}

export function parseLegacyOptionalProviders(raw: string | undefined): ProviderId[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeProviderSelection(
      parsed.filter(
        (entry): entry is ProviderId => typeof entry === "string" && OPTIONAL_PROVIDERS.includes(entry as ProviderId),
      ),
    );
  } catch {
    return [];
  }
}

function hasSuccessfulSnapshot(snapshot: ProviderUsageSnapshot | undefined): boolean {
  return !!snapshot && !isUnavailableSnapshot(snapshot);
}

export function resolveLegacyVisibleProviderOrder(
  enabledOptionalProviders: ProviderId[],
  preferences: MainScreenProviderPreferences,
  snapshots: SnapshotMap,
): ProviderId[] {
  const enabledSet = new Set(enabledOptionalProviders);
  const visibleOptional = OPTIONAL_PROVIDERS.filter((provider) => {
    if (enabledSet.has(provider)) {
      return true;
    }
    if (providerShouldAutoShow(provider, preferences as Record<string, unknown>, snapshots)) {
      return true;
    }
    return hasSuccessfulSnapshot(snapshots[provider]);
  });

  return [...CORE_PROVIDERS, ...visibleOptional];
}

export function resolveStoredMainScreenProviders(
  storedMainScreenProviders: string | undefined,
  storedLegacyOptionalProviders: string | undefined,
  preferences: MainScreenProviderPreferences,
  snapshots: SnapshotMap,
): { providers: ProviderId[]; migrated: boolean } {
  if (storedMainScreenProviders !== undefined) {
    return {
      providers: parseMainScreenProviders(storedMainScreenProviders),
      migrated: false,
    };
  }

  return {
    providers: resolveLegacyVisibleProviderOrder(
      parseLegacyOptionalProviders(storedLegacyOptionalProviders),
      preferences,
      snapshots,
    ),
    migrated: true,
  };
}

function providerSummaryStatusRank(provider: ProviderId, snapshots: SnapshotMap, now = new Date()): number {
  const snapshot = snapshots[provider];
  if (!snapshot) {
    return 0;
  }

  const status = summarizeProviderSnapshot(snapshot, now).status;
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

export function sortMainScreenProviders(
  providers: ProviderId[],
  snapshots: SnapshotMap,
  now = new Date(),
): ProviderId[] {
  const defaultOrder = new Map(PROVIDER_ORDER.map((provider, index) => [provider, index]));
  return [...normalizeProviderSelection(providers)].sort((left, right) => {
    const severityDelta =
      providerSummaryStatusRank(right, snapshots, now) - providerSummaryStatusRank(left, snapshots, now);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return (defaultOrder.get(left) ?? 0) - (defaultOrder.get(right) ?? 0);
  });
}
