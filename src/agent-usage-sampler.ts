import { LocalStorage, getPreferenceValues, updateCommandMetadata } from "@raycast/api";
import { refreshAllProviders } from "./lib/dashboard";
import {
  buildFallbackSnapshot,
  COPILOT_DEVICE_EVENTS_KEY,
  COPILOT_DEVICE_PENDING_KEY,
  COPILOT_LAST_SUCCESS_KEY,
  COPILOT_TOKEN_STORAGE_KEY,
  LEGACY_OPTIONAL_PROVIDERS_KEY,
  MAIN_SCREEN_PROVIDERS_KEY,
  Preferences,
  fetchProviderSnapshotWithPreferences,
  isPendingCopilotLoginExpired,
  PROVIDER_TITLES,
  resolveStoredMainScreenProviders,
} from "./lib/runtime";
import { attachForecastsToSnapshotMap, mergeDerivedSnapshotMap, persistSnapshotMap } from "./lib/snapshot-state";
import { loadDashboardState, loadSamplerStatus, mapSnapshotsByProvider, saveSamplerStatus } from "./lib/storage";
import { PendingCopilotDeviceLogin } from "./models/copilot";
import { ProviderId, ProviderUsageSnapshot } from "./models/usage";
import { isAntigravityLogAdvisorySnapshot } from "./providers/antigravity";

function fallbackSnapshotForProvider(provider: ProviderId, error: unknown): ProviderUsageSnapshot {
  const reason = error instanceof Error ? error.message : `${PROVIDER_TITLES[provider]} usage request failed.`;
  return buildFallbackSnapshot(provider, reason);
}

function isSkippableAntigravityBackgroundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("no antigravity server url found") || normalized.includes("no antigravity csrf token found")
  );
}

export default async function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [
    state,
    storedMainScreenProviders,
    storedLegacyOptionalProviders,
    storedToken,
    storedPendingRaw,
    storedCopilotSuccess,
    storedCopilotEvents,
    previousSamplerStatus,
  ] = await Promise.all([
    loadDashboardState(),
    LocalStorage.getItem<string>(MAIN_SCREEN_PROVIDERS_KEY),
    LocalStorage.getItem<string>(LEGACY_OPTIONAL_PROVIDERS_KEY),
    LocalStorage.getItem<string>(COPILOT_TOKEN_STORAGE_KEY),
    LocalStorage.getItem<string>(COPILOT_DEVICE_PENDING_KEY),
    LocalStorage.getItem<string>(COPILOT_LAST_SUCCESS_KEY),
    LocalStorage.getItem<string>(COPILOT_DEVICE_EVENTS_KEY),
    loadSamplerStatus(),
  ]);

  const currentSnapshots = state?.snapshots?.length
    ? attachForecastsToSnapshotMap(mapSnapshotsByProvider(state.snapshots))
    : {};
  const resolvedVisibility = resolveStoredMainScreenProviders(
    storedMainScreenProviders,
    storedLegacyOptionalProviders,
    preferences,
    currentSnapshots,
  );
  const providerOrder = resolvedVisibility.providers;
  if (resolvedVisibility.migrated) {
    await LocalStorage.setItem(MAIN_SCREEN_PROVIDERS_KEY, JSON.stringify(providerOrder));
  }
  const pendingCopilotLogin = (() => {
    if (!storedPendingRaw) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(storedPendingRaw) as PendingCopilotDeviceLogin;
      return isPendingCopilotLoginExpired(parsed) ? undefined : parsed;
    } catch {
      return undefined;
    }
  })();
  const copilotDeviceEvents = (() => {
    if (!storedCopilotEvents) {
      return [];
    }

    try {
      const parsed = JSON.parse(storedCopilotEvents) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const providerStatusCache = {};
  const skippedProviders: ProviderId[] = [];
  const skipMessages: Partial<Record<ProviderId, string>> = {};

  const result = await refreshAllProviders(
    currentSnapshots,
    async (provider) => {
      try {
        const snapshot = await fetchProviderSnapshotWithPreferences(provider, preferences, {
          copilotToken: storedToken?.trim(),
          pendingCopilotLogin,
          copilotLastSuccessAt: storedCopilotSuccess ?? undefined,
          copilotDeviceEvents,
          providerStatusCache,
        });
        if (provider === "antigravity" && isAntigravityLogAdvisorySnapshot(snapshot)) {
          skippedProviders.push(provider);
          skipMessages[provider] =
            "Live Antigravity quotas were unavailable, so the sampler kept a recent local log hint instead.";
        }
        return snapshot;
      } catch (error) {
        if (provider === "antigravity" && isSkippableAntigravityBackgroundError(error)) {
          skippedProviders.push(provider);
          skipMessages[provider] = "Skipped in background because Antigravity's local language server is not running.";
          const previous = currentSnapshots[provider];
          if (previous) {
            return previous;
          }
        }

        throw error;
      }
    },
    fallbackSnapshotForProvider,
    undefined,
    providerOrder,
  );

  const mergedSnapshots = mergeDerivedSnapshotMap(
    currentSnapshots,
    result.snapshots,
    providerOrder,
    result.refreshedAt,
    "background",
  );
  await persistSnapshotMap(mergedSnapshots, result.refreshedAt);
  await saveSamplerStatus({
    lastSampleAt: result.refreshedAt,
    sampledProviders: providerOrder,
    failedProviders: result.failedProviders,
    failureMessages: result.failureMessages,
    skippedProviders,
    skipMessages,
  });

  if (!result.failedProviders.includes("copilot")) {
    await LocalStorage.setItem(COPILOT_LAST_SUCCESS_KEY, result.refreshedAt);
  }

  const failureTitles = result.failedProviders.map((provider) => PROVIDER_TITLES[provider]);
  const skipTitles = skippedProviders.map((provider) => PROVIDER_TITLES[provider]);
  const unchangedFailures =
    previousSamplerStatus &&
    JSON.stringify(previousSamplerStatus.failedProviders) === JSON.stringify(result.failedProviders) &&
    JSON.stringify(previousSamplerStatus.failureMessages) === JSON.stringify(result.failureMessages) &&
    JSON.stringify(previousSamplerStatus.skippedProviders ?? []) === JSON.stringify(skippedProviders);

  await updateCommandMetadata({
    subtitle:
      providerOrder.length === 0
        ? "No main screen providers selected"
        : result.failedProviders.length > 0
          ? unchangedFailures
            ? `Issues unchanged: ${failureTitles.join(", ")}`
            : `Issues: ${failureTitles.join(", ")}`
          : skippedProviders.length > 0
            ? `Skipped: ${skipTitles.join(", ")}`
            : `Last sample ${new Date(result.refreshedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}`,
  });
}
