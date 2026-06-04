import { Action, ActionPanel, Icon, List, openExtensionPreferences } from "@raycast/api";
import { useEffect, useState } from "react";
import { formatRelativeTimestamp } from "../lib/date";
import { PROVIDER_ORDER, SnapshotMap, isUnavailableSnapshot, summarizeProviderSnapshot } from "../lib/dashboard";
import { statusIcon } from "../lib/format";
import { providerHasConfiguredCredential, PROVIDER_TITLES } from "../lib/provider-registry";
import { Preferences } from "../lib/runtime";
import { ProviderId } from "../models/usage";

interface MainScreenProvidersViewProps {
  visibleProviders: ProviderId[];
  snapshots: SnapshotMap;
  preferences: Preferences;
  refreshingProvider?: ProviderId;
  onShowProvider: (provider: ProviderId, nextProviders: ProviderId[]) => Promise<void>;
  onHideProvider: (provider: ProviderId, nextProviders: ProviderId[]) => Promise<void>;
  onShowAll: (nextProviders: ProviderId[]) => Promise<void>;
  onHideAll: (nextProviders: ProviderId[]) => Promise<void>;
  onRefreshProvider: (provider: ProviderId) => Promise<void>;
}

function hasExplicitProviderConfig(provider: ProviderId, preferences: Preferences): boolean {
  return providerHasConfiguredCredential(provider, preferences as Record<string, unknown>);
}

function providerStateHint(provider: ProviderId, snapshots: SnapshotMap, preferences: Preferences): string {
  const snapshot = snapshots[provider];
  if (snapshot) {
    const state = isUnavailableSnapshot(snapshot) ? "Cached issue" : "Has cached data";
    return `${state} | Updated ${formatRelativeTimestamp(snapshot.fetchedAt)}`;
  }

  if (hasExplicitProviderConfig(provider, preferences)) {
    return "Configured | No cached data yet";
  }

  if (PROVIDER_ORDER.slice(0, 6).includes(provider)) {
    return "No cached data yet";
  }

  return "Needs auth";
}

export function MainScreenProvidersView({
  visibleProviders,
  snapshots,
  preferences,
  refreshingProvider,
  onShowProvider,
  onHideProvider,
  onShowAll,
  onHideAll,
  onRefreshProvider,
}: MainScreenProvidersViewProps) {
  const [localVisibleProviders, setLocalVisibleProviders] = useState<ProviderId[]>(visibleProviders);

  useEffect(() => {
    setLocalVisibleProviders(visibleProviders);
  }, [visibleProviders]);

  const visibleSet = new Set(localVisibleProviders);
  const visibleItems = PROVIDER_ORDER.filter((provider) => visibleSet.has(provider));
  const hiddenItems = PROVIDER_ORDER.filter((provider) => !visibleSet.has(provider));

  const applyVisibleProviders = async (nextProviders: ProviderId[]) => {
    setLocalVisibleProviders(nextProviders);
  };

  const renderProviderItem = (provider: ProviderId) => {
    const snapshot = snapshots[provider];
    const summary = snapshot ? summarizeProviderSnapshot(snapshot) : undefined;
    const isVisible = visibleSet.has(provider);

    return (
      <List.Item
        key={provider}
        icon={statusIcon(summary?.status ?? "unknown")}
        title={PROVIDER_TITLES[provider]}
        subtitle={providerStateHint(provider, snapshots, preferences)}
        accessories={refreshingProvider === provider ? [{ icon: Icon.ArrowClockwise, tooltip: "Refreshing" }] : []}
        actions={
          <ActionPanel>
            <Action
              title={isVisible ? "Hide from Main Screen" : "Show on Main Screen"}
              icon={isVisible ? Icon.EyeDisabled : Icon.Eye}
              onAction={() =>
                void (async () => {
                  if (isVisible) {
                    const nextProviders = localVisibleProviders.filter((entry) => entry !== provider);
                    await applyVisibleProviders(nextProviders);
                    await onHideProvider(provider, nextProviders);
                    return;
                  }

                  const nextProviders = PROVIDER_ORDER.filter(
                    (entry) => entry === provider || localVisibleProviders.includes(entry),
                  );
                  await applyVisibleProviders(nextProviders);
                  await onShowProvider(provider, nextProviders);
                })()
              }
            />
            <Action
              title={`Refresh ${PROVIDER_TITLES[provider]}`}
              icon={Icon.ArrowClockwise}
              onAction={() => void onRefreshProvider(provider)}
            />
            <Action
              title="Show All on Main Screen"
              icon={Icon.Eye}
              onAction={() =>
                void (async () => {
                  const nextProviders = [...PROVIDER_ORDER];
                  await applyVisibleProviders(nextProviders);
                  await onShowAll(nextProviders);
                })()
              }
            />
            <Action
              title="Hide All from Main Screen"
              icon={Icon.EyeDisabled}
              onAction={() =>
                void (async () => {
                  const nextProviders: ProviderId[] = [];
                  await applyVisibleProviders(nextProviders);
                  await onHideAll(nextProviders);
                })()
              }
            />
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List searchBarPlaceholder="Search main screen providers...">
      {visibleItems.length > 0 && (
        <List.Section title="Visible on Main Screen" subtitle={`${visibleItems.length}`}>
          {visibleItems.map((provider) => renderProviderItem(provider))}
        </List.Section>
      )}
      {hiddenItems.length > 0 && (
        <List.Section title="Hidden" subtitle={`${hiddenItems.length}`}>
          {hiddenItems.map((provider) => renderProviderItem(provider))}
        </List.Section>
      )}
    </List>
  );
}
