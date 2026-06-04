import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  LaunchType,
  List,
  LocalStorage,
  Toast,
  environment,
  getPreferenceValues,
  launchCommand,
  open,
  openExtensionPreferences,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MainScreenProvidersView } from "./components/main-screen-providers-view";
import { ProviderDetailView } from "./components/provider-detail-view";
import { providerDescriptor } from "./lib/provider-registry";
import {
  isUnavailableSnapshot,
  PROVIDER_ORDER,
  refreshAllProviders,
  refreshSingleProvider,
  SnapshotMap,
  summarizeProviderSnapshot,
} from "./lib/dashboard";
import { formatRelativeTimestamp } from "./lib/date";
import { statusIcon } from "./lib/format";
import { redactSensitive } from "./lib/redact";
import { fetchProviderStatus, ProviderStatusSnapshot, statusEndpointForProvider } from "./lib/status";
import {
  attachForecastsToSnapshotMap,
  mergeDerivedSnapshot,
  mergeDerivedSnapshotMap,
  persistSnapshotMap,
} from "./lib/snapshot-state";
import { loadDashboardState, loadSamplerStatus, mapSnapshotsByProvider } from "./lib/storage";
import { PendingCopilotDeviceLogin } from "./models/copilot";
import { ProviderId, ProviderUsageSnapshot, SamplerStatusReport } from "./models/usage";
import {
  buildFallbackSnapshot,
  COPILOT_DEVICE_EVENTS_KEY,
  COPILOT_DEVICE_PENDING_KEY,
  COPILOT_LAST_SUCCESS_KEY,
  COPILOT_TOKEN_STORAGE_KEY,
  CURSOR_COOKIE_CACHE_KEY,
  AMP_COOKIE_CACHE_KEY,
  OPENCODE_COOKIE_CACHE_KEY,
  MINIMAX_COOKIE_CACHE_KEY,
  ZED_COOKIE_CACHE_KEY,
  MISTRAL_COOKIE_CACHE_KEY,
  PERPLEXITY_COOKIE_CACHE_KEY,
  GROK_COOKIE_CACHE_KEY,
  WINDSURF_COOKIE_CACHE_KEY,
  AUGMENT_COOKIE_CACHE_KEY,
  LEGACY_OPTIONAL_PROVIDERS_KEY,
  MAIN_SCREEN_PROVIDERS_KEY,
  Preferences,
  PROVIDER_TITLES,
  providerUrl,
  resolveStoredMainScreenProviders,
  sortMainScreenProviders,
} from "./lib/runtime";
import { fetchClaudeSnapshot } from "./providers/claude";
import { fetchClaudeAdminSnapshot } from "./providers/claude-admin";
import { fetchCodexSnapshot } from "./providers/codex";
import { fetchCopilotSnapshot, pollCopilotDeviceToken, requestCopilotDeviceCode } from "./providers/copilot";
import { fetchCursorSnapshot } from "./providers/cursor";
import { fetchGeminiSnapshot } from "./providers/gemini";
import { fetchAntigravitySnapshot } from "./providers/antigravity";
import { fetchOpenAISnapshot } from "./providers/openai";
import { fetchOpenRouterSnapshot } from "./providers/openrouter";
import { fetchZaiSnapshot } from "./providers/zai";
import { fetchDeepSeekSnapshot } from "./providers/deepseek";
import { fetchMoonshotSnapshot } from "./providers/moonshot";
import { fetchMistralSnapshot } from "./providers/mistral";
import { fetchPerplexitySnapshot } from "./providers/perplexity";
import { fetchGrokSnapshot } from "./providers/grok";
import { fetchGroqCloudSnapshot } from "./providers/groqcloud";
import { fetchWindsurfSnapshot } from "./providers/windsurf";
import { fetchAugmentSnapshot } from "./providers/augment";
import { fetchKiroSnapshot } from "./providers/kiro";
import { fetchWarpSnapshot } from "./providers/warp";
import { fetchZedSnapshot } from "./providers/zed";
import { fetchKimiK2Snapshot } from "./providers/kimi-k2";
import { fetchAmpSnapshot } from "./providers/amp";
import { fetchMiniMaxSnapshot } from "./providers/minimax";
import { fetchOpenCodeSnapshot } from "./providers/opencode";
import { fetchOpenCodeGoSnapshot } from "./providers/opencode-go";

const PROVIDER_STATUS_CACHE_TTL_MS = 15 * 60 * 1000;

interface CopilotTokenFormValues {
  token: string;
}

interface CopilotTokenFormProps {
  onSave: (token: string) => Promise<void>;
}

function CopilotTokenForm({ onSave }: CopilotTokenFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Token"
            icon={Icon.Key}
            onSubmit={async (values: CopilotTokenFormValues) => {
              setIsSubmitting(true);
              try {
                await onSave(values.token);
                await popToRoot();
              } finally {
                setIsSubmitting(false);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Copilot Token" text="Paste a GitHub OAuth token for Copilot internal usage API." />
      <Form.PasswordField id="token" title="Token" />
    </Form>
  );
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [mainScreenProviders, setMainScreenProviders] = useState<ProviderId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState<ProviderId | undefined>();
  const [lastRefreshAt, setLastRefreshAt] = useState<string | undefined>();
  const snapshotsRef = useRef<SnapshotMap>({});
  const visibleProviderOrderRef = useRef<ProviderId[]>([]);
  const hasHydratedRef = useRef(false);
  const copilotTokenRef = useRef<string | undefined>(undefined);
  const cursorCookieCacheRef = useRef<string | undefined>(undefined);
  const ampCookieCacheRef = useRef<string | undefined>(undefined);
  const opencodeCookieCacheRef = useRef<string | undefined>(undefined);
  const minimaxCookieCacheRef = useRef<string | undefined>(undefined);
  const zedCookieCacheRef = useRef<string | undefined>(undefined);
  const mistralCookieCacheRef = useRef<string | undefined>(undefined);
  const perplexityCookieCacheRef = useRef<string | undefined>(undefined);
  const grokCookieCacheRef = useRef<string | undefined>(undefined);
  const windsurfCookieCacheRef = useRef<string | undefined>(undefined);
  const augmentCookieCacheRef = useRef<string | undefined>(undefined);
  const providerStatusCacheRef = useRef<Partial<Record<ProviderId, ProviderStatusSnapshot>>>({});
  const [copilotTokenState, setCopilotTokenState] = useState<string | undefined>();
  const [pendingCopilotLogin, setPendingCopilotLogin] = useState<PendingCopilotDeviceLogin | undefined>();
  const [copilotLastSuccessAt, setCopilotLastSuccessAt] = useState<string | undefined>();
  const [copilotDeviceEvents, setCopilotDeviceEvents] = useState<string[]>([]);
  const [samplerStatus, setSamplerStatus] = useState<SamplerStatusReport | undefined>();

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

  const visibleProviderOrder = useMemo(() => {
    return sortMainScreenProviders(mainScreenProviders, snapshots);
  }, [mainScreenProviders, snapshots]);

  useEffect(() => {
    visibleProviderOrderRef.current = visibleProviderOrder;
  }, [visibleProviderOrder]);

  const isPendingCopilotLoginExpired = useCallback((pending: PendingCopilotDeviceLogin | undefined): boolean => {
    if (!pending) {
      return true;
    }

    const createdMs = Date.parse(pending.createdAt);
    if (Number.isNaN(createdMs)) {
      return true;
    }

    return Date.now() > createdMs + pending.expiresIn * 1000;
  }, []);

  const clearPendingCopilotLogin = useCallback(async () => {
    await LocalStorage.removeItem(COPILOT_DEVICE_PENDING_KEY);
    setPendingCopilotLogin(undefined);
  }, []);

  const appendCopilotDeviceEvent = useCallback(
    async (event: string) => {
      const timestamped = `${new Date().toISOString()}: ${event}`;
      const next = [timestamped, ...copilotDeviceEvents].slice(0, 8);
      setCopilotDeviceEvents(next);
      await LocalStorage.setItem(COPILOT_DEVICE_EVENTS_KEY, JSON.stringify(next));
    },
    [copilotDeviceEvents],
  );

  const persistSnapshots = useCallback(async (next: SnapshotMap, refreshAt?: string) => {
    await persistSnapshotMap(next, refreshAt);
  }, []);

  const resolveCopilotToken = useCallback((): string | undefined => {
    const preferenceToken = preferences.copilotApiToken?.trim();
    if (preferenceToken) {
      return preferenceToken;
    }

    return copilotTokenRef.current?.trim();
  }, [preferences.copilotApiToken]);

  const enrichSnapshotWithStatus = useCallback(
    async (snapshot: ProviderUsageSnapshot): Promise<ProviderUsageSnapshot> => {
      if (!preferences.checkProviderStatus) {
        return snapshot;
      }

      const endpoint = statusEndpointForProvider(snapshot.provider);
      if (!endpoint) {
        return snapshot;
      }

      const now = Date.now();
      const cached = providerStatusCacheRef.current[snapshot.provider];
      const cachedAt = cached ? Date.parse(cached.checkedAt) : NaN;
      let statusSnapshot = cached;

      if (!cached || Number.isNaN(cachedAt) || now - cachedAt > PROVIDER_STATUS_CACHE_TTL_MS) {
        statusSnapshot = await fetchProviderStatus(snapshot.provider);
        if (statusSnapshot) {
          providerStatusCacheRef.current[snapshot.provider] = statusSnapshot;
        }
      }

      if (!statusSnapshot || statusSnapshot.level === "operational" || statusSnapshot.level === "unknown") {
        return snapshot;
      }

      const statusText = `${statusSnapshot.level.toUpperCase()}: ${statusSnapshot.summary}`;
      const nextHighlights = [...(snapshot.highlights ?? [])];
      if (!nextHighlights.some((entry) => entry === `Status: ${statusText}`)) {
        nextHighlights.push(`Status: ${statusText}`);
      }

      const existingSections = snapshot.metadataSections ?? [];
      const statusSection = {
        id: "service-status",
        title: "Service Status",
        items: [
          { label: "Level", value: statusSnapshot.level },
          { label: "Summary", value: statusSnapshot.summary },
          { label: "Endpoint", value: endpoint },
          { label: "Checked", value: statusSnapshot.checkedAt },
        ],
      };
      const metadataSections = [
        ...existingSections.filter((section) => section.id !== "service-status"),
        statusSection,
      ];
      return {
        ...snapshot,
        highlights: nextHighlights,
        metadataSections,
      };
    },
    [preferences.checkProviderStatus],
  );

  const fetchProviderSnapshot = useCallback(
    async (provider: ProviderId): Promise<ProviderUsageSnapshot> => {
      const withStatus = async (snapshot: ProviderUsageSnapshot): Promise<ProviderUsageSnapshot> =>
        enrichSnapshotWithStatus(snapshot);

      if (provider === "codex") {
        return withStatus(await fetchCodexSnapshot(preferences.codexAuthToken));
      }

      if (provider === "openai") {
        return withStatus(await fetchOpenAISnapshot(preferences.openaiAdminApiKey, preferences.openaiApiKey));
      }

      if (provider === "claude") {
        return withStatus(await fetchClaudeSnapshot(preferences.claudeAccessToken));
      }

      if (provider === "claude-admin") {
        return withStatus(
          await fetchClaudeAdminSnapshot(preferences.claudeAdminApiKey, preferences.claudeAdminUsageUrl),
        );
      }

      if (provider === "cursor") {
        return withStatus(
          await fetchCursorSnapshot({
            cookieHeader: preferences.cursorCookieHeader,
            cookieSourceMode: preferences.cursorCookieSourceMode,
            cachedCookieHeader: cursorCookieCacheRef.current,
            onCookieResolved: async (cookieHeader) => {
              cursorCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(CURSOR_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "gemini") {
        return withStatus(await fetchGeminiSnapshot(preferences.geminiAccessToken));
      }

      if (provider === "antigravity") {
        return withStatus(
          await fetchAntigravitySnapshot(preferences.antigravityServerUrl, preferences.antigravityCsrfToken),
        );
      }

      if (provider === "openrouter") {
        return withStatus(
          await fetchOpenRouterSnapshot(preferences.openrouterApiKey, preferences.openrouterApiBaseUrl),
        );
      }

      if (provider === "zai") {
        return withStatus(await fetchZaiSnapshot(preferences.zaiApiKey, preferences.zaiQuotaUrl));
      }

      if (provider === "deepseek") {
        return withStatus(await fetchDeepSeekSnapshot(preferences.deepseekApiKey));
      }

      if (provider === "moonshot") {
        return withStatus(
          await fetchMoonshotSnapshot(
            preferences.moonshotApiKey,
            preferences.moonshotRegion,
            preferences.moonshotBalanceUrl,
          ),
        );
      }

      if (provider === "mistral") {
        return withStatus(
          await fetchMistralSnapshot({
            cookieHeader: preferences.mistralCookieHeader,
            cookieSourceMode: preferences.mistralCookieSourceMode,
            cachedCookieHeader: mistralCookieCacheRef.current,
            usageUrl: preferences.mistralUsageApiUrl,
            onCookieResolved: async (cookieHeader) => {
              mistralCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(MISTRAL_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "perplexity") {
        return withStatus(
          await fetchPerplexitySnapshot({
            cookieHeader: preferences.perplexityCookieHeader,
            sessionToken: preferences.perplexitySessionToken,
            cookieSourceMode: preferences.perplexityCookieSourceMode,
            cachedCookieHeader: perplexityCookieCacheRef.current,
            usageUrl: preferences.perplexityUsageApiUrl,
            onCookieResolved: async (cookieHeader) => {
              perplexityCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(PERPLEXITY_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "grok") {
        return withStatus(
          await fetchGrokSnapshot({
            cookieHeader: preferences.grokCookieHeader,
            cookieSourceMode: preferences.grokCookieSourceMode,
            cachedCookieHeader: grokCookieCacheRef.current,
            usageUrl: preferences.grokUsageApiUrl,
            onCookieResolved: async (cookieHeader) => {
              grokCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(GROK_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "groqcloud") {
        return withStatus(await fetchGroqCloudSnapshot(preferences.groqcloudApiKey, preferences.groqcloudUsageApiUrl));
      }

      if (provider === "windsurf") {
        return withStatus(
          await fetchWindsurfSnapshot({
            cookieHeader: preferences.windsurfCookieHeader,
            cookieSourceMode: preferences.windsurfCookieSourceMode,
            cachedCookieHeader: windsurfCookieCacheRef.current,
            usageUrl: preferences.windsurfUsageApiUrl,
            onCookieResolved: async (cookieHeader) => {
              windsurfCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(WINDSURF_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "augment") {
        return withStatus(
          await fetchAugmentSnapshot({
            apiKey: preferences.augmentApiKey,
            cookieHeader: preferences.augmentCookieHeader,
            cookieSourceMode: preferences.augmentCookieSourceMode,
            cachedCookieHeader: augmentCookieCacheRef.current,
            usageUrl: preferences.augmentUsageApiUrl,
            onCookieResolved: async (cookieHeader) => {
              augmentCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(AUGMENT_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "kiro") {
        return withStatus(await fetchKiroSnapshot(preferences.kiroCliPath));
      }

      if (provider === "warp") {
        return withStatus(await fetchWarpSnapshot(preferences.warpApiKey, preferences.warpGraphqlUrl));
      }

      if (provider === "zed") {
        return withStatus(
          await fetchZedSnapshot({
            cookieHeader: preferences.zedCookieHeader,
            cookieSourceMode: preferences.zedCookieSourceMode,
            cachedCookieHeader: zedCookieCacheRef.current,
            onCookieResolved: async (cookieHeader) => {
              zedCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(ZED_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "kimi-k2") {
        return withStatus(await fetchKimiK2Snapshot(preferences.kimiK2ApiKey));
      }

      if (provider === "amp") {
        return withStatus(
          await fetchAmpSnapshot({
            cookieHeader: preferences.ampCookieHeader,
            cookieSourceMode: preferences.ampCookieSourceMode,
            cachedCookieHeader: ampCookieCacheRef.current,
            onCookieResolved: async (cookieHeader) => {
              ampCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(AMP_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "minimax") {
        return withStatus(
          await fetchMiniMaxSnapshot({
            apiKey: preferences.minimaxApiKey,
            cookieHeader: preferences.minimaxCookieHeader,
            cookieSourceMode: preferences.minimaxCookieSourceMode,
            cachedCookieHeader: minimaxCookieCacheRef.current,
            onCookieResolved: async (cookieHeader) => {
              minimaxCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(MINIMAX_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "opencode") {
        return withStatus(
          await fetchOpenCodeSnapshot({
            cookieHeader: preferences.opencodeCookieHeader,
            cookieSourceMode: preferences.opencodeCookieSourceMode,
            cachedCookieHeader: opencodeCookieCacheRef.current,
            workspaceId: preferences.opencodeWorkspaceId,
            onCookieResolved: async (cookieHeader) => {
              opencodeCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(OPENCODE_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      if (provider === "opencode-go") {
        return withStatus(
          await fetchOpenCodeGoSnapshot({
            cookieHeader: preferences.opencodeCookieHeader,
            cookieSourceMode: preferences.opencodeCookieSourceMode,
            cachedCookieHeader: opencodeCookieCacheRef.current,
            workspaceId: preferences.opencodeWorkspaceId,
            onCookieResolved: async (cookieHeader) => {
              opencodeCookieCacheRef.current = cookieHeader;
              await LocalStorage.setItem(OPENCODE_COOKIE_CACHE_KEY, cookieHeader);
            },
          }),
        );
      }

      const copilotToken = resolveCopilotToken();
      if (!copilotToken) {
        const pending = pendingCopilotLogin;
        if (pending && !isPendingCopilotLoginExpired(pending)) {
          throw new Error(
            `Device code ${pending.userCode} pending. Complete login, then run Complete Copilot Device Login.`,
          );
        }

        throw new Error("No Copilot token configured. Start Copilot Device Login.");
      }

      const tokenSource = preferences.copilotApiToken?.trim() ? "preference" : "local storage";
      return withStatus(
        await fetchCopilotSnapshot(copilotToken, {
          tokenSource,
          lastSuccessAt: copilotLastSuccessAt,
          recentDeviceEvents: copilotDeviceEvents.slice(0, 3),
          githubEnterpriseBaseUrl: preferences.copilotEnterpriseUrl,
        }),
      );
    },
    [
      enrichSnapshotWithStatus,
      copilotDeviceEvents,
      copilotLastSuccessAt,
      isPendingCopilotLoginExpired,
      pendingCopilotLogin,
      preferences.claudeAccessToken,
      preferences.claudeAdminApiKey,
      preferences.claudeAdminUsageUrl,
      preferences.checkProviderStatus,
      preferences.codexAuthToken,
      preferences.openaiAdminApiKey,
      preferences.openaiApiKey,
      preferences.copilotApiToken,
      preferences.copilotEnterpriseUrl,
      preferences.cursorCookieHeader,
      preferences.cursorCookieSourceMode,
      preferences.geminiAccessToken,
      preferences.antigravityServerUrl,
      preferences.antigravityCsrfToken,
      preferences.openrouterApiKey,
      preferences.openrouterApiBaseUrl,
      preferences.zaiApiKey,
      preferences.zaiQuotaUrl,
      preferences.deepseekApiKey,
      preferences.moonshotApiKey,
      preferences.moonshotRegion,
      preferences.moonshotBalanceUrl,
      preferences.mistralCookieHeader,
      preferences.mistralCookieSourceMode,
      preferences.mistralUsageApiUrl,
      preferences.perplexityCookieHeader,
      preferences.perplexitySessionToken,
      preferences.perplexityCookieSourceMode,
      preferences.perplexityUsageApiUrl,
      preferences.grokCookieHeader,
      preferences.grokCookieSourceMode,
      preferences.grokUsageApiUrl,
      preferences.groqcloudApiKey,
      preferences.groqcloudUsageApiUrl,
      preferences.windsurfCookieHeader,
      preferences.windsurfCookieSourceMode,
      preferences.windsurfUsageApiUrl,
      preferences.augmentApiKey,
      preferences.augmentCookieHeader,
      preferences.augmentCookieSourceMode,
      preferences.augmentUsageApiUrl,
      preferences.kiroCliPath,
      preferences.warpApiKey,
      preferences.warpGraphqlUrl,
      preferences.kimiK2ApiKey,
      preferences.ampCookieHeader,
      preferences.ampCookieSourceMode,
      preferences.minimaxApiKey,
      preferences.minimaxCookieHeader,
      preferences.minimaxCookieSourceMode,
      preferences.opencodeCookieHeader,
      preferences.opencodeCookieSourceMode,
      preferences.opencodeWorkspaceId,
      resolveCopilotToken,
    ],
  );

  const fallbackSnapshotForProvider = useCallback((provider: ProviderId, error: unknown): ProviderUsageSnapshot => {
    const reason = error instanceof Error ? error.message : `${PROVIDER_TITLES[provider]} usage request failed.`;
    return buildFallbackSnapshot(provider, reason);
  }, []);

  const refreshProvider = useCallback(
    async (provider: ProviderId, showSuccess = false) => {
      setRefreshingProvider(provider);

      try {
        const result = await refreshSingleProvider(
          snapshotsRef.current,
          provider,
          fetchProviderSnapshot,
          fallbackSnapshotForProvider,
        );
        const mergedSnapshot = mergeDerivedSnapshot(
          snapshotsRef.current[provider],
          result.snapshot,
          result.refreshedAt,
          "manual",
        );
        const mergedSnapshots: SnapshotMap = {
          ...result.snapshots,
          [provider]: mergedSnapshot,
        };

        setSnapshots(mergedSnapshots);
        snapshotsRef.current = mergedSnapshots;
        setLastRefreshAt(result.refreshedAt);
        await persistSnapshots(mergedSnapshots, result.refreshedAt);

        if (provider === "copilot" && !result.failed) {
          setCopilotLastSuccessAt(result.refreshedAt);
          await LocalStorage.setItem(COPILOT_LAST_SUCCESS_KEY, result.refreshedAt);
        }

        if (showSuccess) {
          await showToast({
            title: result.failed
              ? `${PROVIDER_TITLES[provider]} refresh failed`
              : `${PROVIDER_TITLES[provider]} refreshed`,
            message: result.failed ? "Showing fallback status." : undefined,
            style: result.failed ? Toast.Style.Failure : Toast.Style.Success,
          });
        }
      } finally {
        setRefreshingProvider(undefined);
      }
    },
    [fallbackSnapshotForProvider, fetchProviderSnapshot, persistSnapshots],
  );

  const refreshAllRemoteProviders = useCallback(
    async (showSuccess = false) => {
      setIsRefreshingAll(true);

      try {
        const providerOrder = visibleProviderOrderRef.current;
        const result = await refreshAllProviders(
          snapshotsRef.current,
          fetchProviderSnapshot,
          fallbackSnapshotForProvider,
          undefined,
          providerOrder,
        );
        const mergedSnapshots = mergeDerivedSnapshotMap(
          snapshotsRef.current,
          result.snapshots,
          providerOrder,
          result.refreshedAt,
          "manual",
        );

        setSnapshots(mergedSnapshots);
        snapshotsRef.current = mergedSnapshots;
        setLastRefreshAt(result.refreshedAt);
        await persistSnapshots(mergedSnapshots, result.refreshedAt);

        if (!result.failedProviders.includes("copilot")) {
          setCopilotLastSuccessAt(result.refreshedAt);
          await LocalStorage.setItem(COPILOT_LAST_SUCCESS_KEY, result.refreshedAt);
        }

        if (showSuccess) {
          const failedCount = result.failedProviders.length;
          await showToast({
            title: failedCount > 0 ? "Refresh complete with issues" : "Usage refreshed",
            message:
              failedCount > 0
                ? `Failed providers: ${result.failedProviders.map((provider) => PROVIDER_TITLES[provider]).join(", ")}`
                : undefined,
            style: failedCount > 0 ? Toast.Style.Failure : Toast.Style.Success,
          });
        }
      } finally {
        setIsRefreshingAll(false);
      }
    },
    [fallbackSnapshotForProvider, fetchProviderSnapshot, persistSnapshots],
  );

  const saveCopilotToken = useCallback(
    async (token: string) => {
      const normalized = token.trim();
      if (!normalized) {
        throw new Error("Token is empty.");
      }

      await LocalStorage.setItem(COPILOT_TOKEN_STORAGE_KEY, normalized);
      copilotTokenRef.current = normalized;
      setCopilotTokenState(normalized);
      await showToast({
        title: "Copilot token saved",
        style: Toast.Style.Success,
      });
      await refreshProvider("copilot", false);
    },
    [refreshProvider],
  );

  const clearStoredCopilotToken = useCallback(async () => {
    await LocalStorage.removeItem(COPILOT_TOKEN_STORAGE_KEY);
    copilotTokenRef.current = undefined;
    setCopilotTokenState(undefined);
    await showToast({
      title: "Stored Copilot token removed",
      style: Toast.Style.Success,
    });
    await refreshProvider("copilot", false);
  }, [refreshProvider]);

  const persistMainScreenProviderSelection = useCallback(async (providers: ProviderId[]) => {
    setMainScreenProviders(providers);
    visibleProviderOrderRef.current = sortMainScreenProviders(providers, snapshotsRef.current);
    await LocalStorage.setItem(MAIN_SCREEN_PROVIDERS_KEY, JSON.stringify(providers));
  }, []);

  const showProviderOnMainScreen = useCallback(
    async (provider: ProviderId, nextProviders: ProviderId[]) => {
      await persistMainScreenProviderSelection(nextProviders);
      await showToast({
        title: "Main screen providers updated",
        message: `${PROVIDER_TITLES[provider]} is now visible`,
        style: Toast.Style.Success,
      });
      await refreshProvider(provider, false);
    },
    [persistMainScreenProviderSelection, refreshProvider],
  );

  const hideProviderFromMainScreen = useCallback(
    async (provider: ProviderId, nextProviders: ProviderId[]) => {
      await persistMainScreenProviderSelection(nextProviders);
      await showToast({
        title: "Main screen providers updated",
        message: `${PROVIDER_TITLES[provider]} hidden`,
        style: Toast.Style.Success,
      });
    },
    [persistMainScreenProviderSelection],
  );

  const showAllMainScreenProviders = useCallback(
    async (nextProviders: ProviderId[]) => {
      await persistMainScreenProviderSelection(nextProviders);
      await showToast({
        title: "Main screen providers updated",
        message: `${nextProviders.length} visible`,
        style: Toast.Style.Success,
      });
      await refreshAllRemoteProviders(false);
    },
    [persistMainScreenProviderSelection, refreshAllRemoteProviders],
  );

  const hideAllMainScreenProviders = useCallback(
    async (nextProviders: ProviderId[]) => {
      await persistMainScreenProviderSelection(nextProviders);
      await showToast({
        title: "Main screen providers updated",
        message: "No providers visible",
        style: Toast.Style.Success,
      });
    },
    [persistMainScreenProviderSelection],
  );

  const startCopilotDeviceFlow = useCallback(async () => {
    const startingToast = await showToast({
      title: "Starting Copilot login",
      message: "Requesting GitHub device code...",
      style: Toast.Style.Animated,
    });

    try {
      await appendCopilotDeviceEvent("Device flow started");
      const device = await requestCopilotDeviceCode(preferences.copilotEnterpriseUrl);
      const pending: PendingCopilotDeviceLogin = {
        ...device,
        createdAt: new Date().toISOString(),
      };

      await LocalStorage.setItem(COPILOT_DEVICE_PENDING_KEY, JSON.stringify(pending));
      setPendingCopilotLogin(pending);
      await Clipboard.copy(pending.userCode);
      await open(pending.verificationUri);
      await refreshProvider("copilot", false);

      startingToast.style = Toast.Style.Success;
      startingToast.title = "Copilot code ready";
      startingToast.message = `Code ${pending.userCode} copied. Paste on GitHub page, then run Complete Copilot Device Login.`;
      await appendCopilotDeviceEvent(`Device code issued (${pending.userCode})`);
    } catch (error) {
      startingToast.style = Toast.Style.Failure;
      startingToast.title = "Copilot login failed";
      startingToast.message = error instanceof Error ? error.message : "Unknown device flow error.";
      await appendCopilotDeviceEvent("Device flow start failed");
    }
  }, [appendCopilotDeviceEvent, preferences.copilotEnterpriseUrl, refreshProvider]);

  const completeCopilotDeviceFlow = useCallback(async () => {
    const pending = pendingCopilotLogin;
    if (!pending) {
      await showToast({
        title: "No pending login",
        message: "Run Start Copilot Device Login first.",
        style: Toast.Style.Failure,
      });
      await appendCopilotDeviceEvent("Device flow completion attempted without pending code");
      return;
    }

    if (isPendingCopilotLoginExpired(pending)) {
      await clearPendingCopilotLogin();
      await showToast({
        title: "Device code expired",
        message: "Start Copilot Device Login again.",
        style: Toast.Style.Failure,
      });
      await appendCopilotDeviceEvent("Device code expired");
      await refreshProvider("copilot", false);
      return;
    }

    const waitingToast = await showToast({
      title: "Completing Copilot login",
      message: `Waiting for GitHub auth (code ${pending.userCode})...`,
      style: Toast.Style.Animated,
    });

    try {
      const token = await pollCopilotDeviceToken(pending, preferences.copilotEnterpriseUrl);
      await LocalStorage.setItem(COPILOT_TOKEN_STORAGE_KEY, token);
      copilotTokenRef.current = token;
      setCopilotTokenState(token);
      await clearPendingCopilotLogin();
      waitingToast.style = Toast.Style.Success;
      waitingToast.title = "Copilot connected";
      waitingToast.message = "Token saved and ready.";
      await appendCopilotDeviceEvent("Device flow completed successfully");
      await refreshProvider("copilot", false);
    } catch (error) {
      waitingToast.style = Toast.Style.Failure;
      waitingToast.title = "Copilot login failed";
      waitingToast.message = error instanceof Error ? error.message : "Unknown device flow error.";
      await appendCopilotDeviceEvent("Device flow completion failed");
    }
  }, [
    appendCopilotDeviceEvent,
    clearPendingCopilotLogin,
    isPendingCopilotLoginExpired,
    pendingCopilotLogin,
    preferences.copilotEnterpriseUrl,
    refreshProvider,
  ]);

  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }
    hasHydratedRef.current = true;

    async function hydrate() {
      const [
        state,
        storedCopilotToken,
        storedPendingRaw,
        storedCopilotSuccess,
        storedCopilotEvents,
        storedMainScreenProviders,
        storedLegacyOptionalProviders,
        storedCursorCookie,
        storedAmpCookie,
        storedOpenCodeCookie,
        storedMiniMaxCookie,
        storedZedCookie,
        storedMistralCookie,
        storedPerplexityCookie,
        storedGrokCookie,
        storedWindsurfCookie,
        storedAugmentCookie,
        storedSamplerStatus,
      ] = await Promise.all([
        loadDashboardState(),
        LocalStorage.getItem<string>(COPILOT_TOKEN_STORAGE_KEY),
        LocalStorage.getItem<string>(COPILOT_DEVICE_PENDING_KEY),
        LocalStorage.getItem<string>(COPILOT_LAST_SUCCESS_KEY),
        LocalStorage.getItem<string>(COPILOT_DEVICE_EVENTS_KEY),
        LocalStorage.getItem<string>(MAIN_SCREEN_PROVIDERS_KEY),
        LocalStorage.getItem<string>(LEGACY_OPTIONAL_PROVIDERS_KEY),
        LocalStorage.getItem<string>(CURSOR_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(AMP_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(OPENCODE_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(MINIMAX_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(ZED_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(MISTRAL_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(PERPLEXITY_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(GROK_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(WINDSURF_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(AUGMENT_COOKIE_CACHE_KEY),
        loadSamplerStatus(),
      ]);

      const normalizedStoredToken = storedCopilotToken?.trim();
      if (normalizedStoredToken) {
        copilotTokenRef.current = normalizedStoredToken;
        setCopilotTokenState(normalizedStoredToken);
      }

      if (storedPendingRaw) {
        try {
          const parsed = JSON.parse(storedPendingRaw) as PendingCopilotDeviceLogin;
          if (isPendingCopilotLoginExpired(parsed)) {
            await LocalStorage.removeItem(COPILOT_DEVICE_PENDING_KEY);
          } else {
            setPendingCopilotLogin(parsed);
          }
        } catch {
          await LocalStorage.removeItem(COPILOT_DEVICE_PENDING_KEY);
        }
      }

      if (storedCopilotSuccess) {
        setCopilotLastSuccessAt(storedCopilotSuccess);
      }

      if (storedCopilotEvents) {
        try {
          const parsed = JSON.parse(storedCopilotEvents) as string[];
          setCopilotDeviceEvents(Array.isArray(parsed) ? parsed : []);
        } catch {
          setCopilotDeviceEvents([]);
        }
      }

      setSamplerStatus(storedSamplerStatus);

      cursorCookieCacheRef.current = storedCursorCookie?.trim();
      ampCookieCacheRef.current = storedAmpCookie?.trim();
      opencodeCookieCacheRef.current = storedOpenCodeCookie?.trim();
      minimaxCookieCacheRef.current = storedMiniMaxCookie?.trim();
      zedCookieCacheRef.current = storedZedCookie?.trim();
      mistralCookieCacheRef.current = storedMistralCookie?.trim();
      perplexityCookieCacheRef.current = storedPerplexityCookie?.trim();
      grokCookieCacheRef.current = storedGrokCookie?.trim();
      windsurfCookieCacheRef.current = storedWindsurfCookie?.trim();
      augmentCookieCacheRef.current = storedAugmentCookie?.trim();

      const initialSnapshots = state?.snapshots?.length
        ? attachForecastsToSnapshotMap(mapSnapshotsByProvider(state.snapshots))
        : {};
      if (state?.snapshots?.length) {
        setSnapshots(initialSnapshots);
        setLastRefreshAt(state.lastRefreshAt);
      }

      const resolvedVisibility = resolveStoredMainScreenProviders(
        storedMainScreenProviders,
        storedLegacyOptionalProviders,
        preferences,
        initialSnapshots,
      );
      setMainScreenProviders(resolvedVisibility.providers);
      visibleProviderOrderRef.current = sortMainScreenProviders(resolvedVisibility.providers, initialSnapshots);
      if (resolvedVisibility.migrated) {
        await LocalStorage.setItem(MAIN_SCREEN_PROVIDERS_KEY, JSON.stringify(resolvedVisibility.providers));
      }

      setIsLoading(false);
      if (environment.launchType !== LaunchType.Background) {
        void launchCommand({ name: "agent-usage-sampler", type: LaunchType.Background }).catch(() => undefined);
      }
      await refreshAllRemoteProviders(false);
    }

    void hydrate();
  }, [isPendingCopilotLoginExpired, refreshAllRemoteProviders]);

  const renderedSnapshots = useMemo(() => {
    return visibleProviderOrder.map((providerId) => {
      const snapshot = snapshots[providerId];
      if (snapshot) {
        return snapshot;
      }

      if (providerId === "codex") {
        return buildFallbackSnapshot("codex", "Run `codex login` then refresh.");
      }

      if (providerId === "claude") {
        return buildFallbackSnapshot("claude", "Run `claude login` then refresh, or set Claude OAuth token.");
      }

      if (providerId === "cursor") {
        return buildFallbackSnapshot(
          "cursor",
          "Use Cursor Cookie Source Auto (browser import) or set Cursor Cookie Header manually.",
        );
      }

      if (providerId === "gemini") {
        return buildFallbackSnapshot("gemini", "Run `gemini` to authenticate, then refresh.");
      }

      if (providerId === "antigravity") {
        return buildFallbackSnapshot(
          "antigravity",
          "Keep Antigravity running for auto-detect, or set Server URL + CSRF token in preferences.",
        );
      }

      if (providerId === "openrouter") {
        return buildFallbackSnapshot("openrouter", "Set OpenRouter API Key in extension preferences.");
      }

      if (providerId === "zai") {
        return buildFallbackSnapshot("zai", "Set z.ai API Key in extension preferences.");
      }

      if (providerId === "zed") {
        return buildFallbackSnapshot(
          "zed",
          "Set Zed Cookie Source Auto (browser import) or set Zed Cookie Header manually.",
        );
      }

      if (providerId === "kimi-k2") {
        return buildFallbackSnapshot("kimi-k2", "Set Kimi K2 API Key in extension preferences.");
      }

      if (providerId === "amp") {
        return buildFallbackSnapshot(
          "amp",
          "Set Amp Cookie Source Auto (browser import) or set Amp Cookie Header manually.",
        );
      }

      if (providerId === "minimax") {
        return buildFallbackSnapshot(
          "minimax",
          "Set MiniMax API Key, or use MiniMax Cookie Source Auto/manual with authenticated session.",
        );
      }

      if (providerId === "opencode") {
        return buildFallbackSnapshot(
          "opencode",
          "Set OpenCode Cookie Source Auto (browser import) or set OpenCode Cookie Header manually.",
        );
      }

      return buildFallbackSnapshot(providerId, providerDescriptor(providerId).repairHint);
    });
  }, [snapshots, visibleProviderOrder]);

  const hasStoredCopilotToken = !!copilotTokenState?.trim();
  const samplerFailureEntries = useMemo(
    () =>
      (samplerStatus?.failedProviders ?? []).map((provider) => ({
        provider,
        message: samplerStatus?.failureMessages?.[provider] ?? "Background sample failed.",
      })),
    [samplerStatus],
  );
  const samplerSkipEntries = useMemo(
    () =>
      (samplerStatus?.skippedProviders ?? []).map((provider) => ({
        provider,
        message: samplerStatus?.skipMessages?.[provider] ?? "Background sample skipped.",
      })),
    [samplerStatus],
  );
  const samplerSubtitle = useMemo(() => {
    if (!samplerStatus?.lastSampleAt) {
      return "No background sample yet";
    }

    const parts = [`Last sample ${formatRelativeTimestamp(samplerStatus.lastSampleAt)}`];
    if (samplerStatus.failedProviders.length > 0) {
      parts.push(`Issues: ${samplerStatus.failedProviders.map((provider) => PROVIDER_TITLES[provider]).join(", ")}`);
    } else if ((samplerStatus.skippedProviders?.length ?? 0) > 0) {
      parts.push(`Skipped: ${samplerStatus.skippedProviders?.map((provider) => PROVIDER_TITLES[provider]).join(", ")}`);
    } else {
      parts.push(`${samplerStatus.sampledProviders.length} providers sampled cleanly`);
    }

    return parts.join(" | ");
  }, [samplerStatus]);

  const runBackgroundSampler = useCallback(async () => {
    await launchCommand({ name: "agent-usage-sampler", type: LaunchType.Background });
    await showToast({
      title: "Background sampler started",
      message: "Reopen the command in a few seconds to see updated sampler status.",
      style: Toast.Style.Success,
    });
  }, []);

  const repairProviderAuth = useCallback(
    async (provider: ProviderId) => {
      if (provider === "codex") {
        await Clipboard.copy("codex login");
        await openExtensionPreferences();
        await showToast({
          title: "Codex auth repair",
          message: "Copied `codex login`. Run it in terminal, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "claude") {
        await Clipboard.copy("claude login");
        await openExtensionPreferences();
        await showToast({
          title: "Claude auth repair",
          message: "Copied `claude login`. Run it in terminal, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "cursor") {
        await openExtensionPreferences();
        await showToast({
          title: "Cursor auth repair",
          message: "Set Cursor Cookie Source to Auto or provide a Cursor Cookie Header, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "gemini") {
        await Clipboard.copy("gemini");
        await openExtensionPreferences();
        await showToast({
          title: "Gemini auth repair",
          message: "Copied `gemini`. Run it in terminal to authenticate, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "antigravity") {
        await openExtensionPreferences();
        await showToast({
          title: "Antigravity auth repair",
          message: "Auto-detect works when Antigravity is running; otherwise set Server URL + CSRF token.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "openrouter") {
        await openExtensionPreferences();
        await showToast({
          title: "OpenRouter auth repair",
          message: "Set OpenRouter API Key in preferences, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "zai") {
        await openExtensionPreferences();
        await showToast({
          title: "z.ai auth repair",
          message: "Set z.ai API Key in preferences, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "zed") {
        await openExtensionPreferences();
        await showToast({
          title: "Zed auth repair",
          message: "Set Zed Cookie Source to Auto or provide a Zed Cookie Header, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "kimi-k2") {
        await openExtensionPreferences();
        await showToast({
          title: "Kimi K2 auth repair",
          message: "Set Kimi K2 API Key in preferences, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "amp") {
        await openExtensionPreferences();
        await showToast({
          title: "Amp auth repair",
          message: "Set Amp Cookie Source to Auto or provide Amp Cookie Header, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "minimax") {
        await openExtensionPreferences();
        await showToast({
          title: "MiniMax auth repair",
          message: "Set MiniMax API Key or MiniMax Cookie Source/header in preferences, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider === "opencode") {
        await openExtensionPreferences();
        await showToast({
          title: "OpenCode auth repair",
          message: "Set OpenCode Cookie Source to Auto or provide OpenCode Cookie Header, then refresh.",
          style: Toast.Style.Success,
        });
        return;
      }

      if (provider !== "copilot") {
        const descriptor = providerDescriptor(provider);
        await openExtensionPreferences();
        await showToast({
          title: `${descriptor.title} auth repair`,
          message: descriptor.repairHint,
          style: Toast.Style.Success,
        });
        return;
      }

      const pending = pendingCopilotLogin;
      if (pending && !isPendingCopilotLoginExpired(pending)) {
        await completeCopilotDeviceFlow();
        return;
      }

      await startCopilotDeviceFlow();
    },
    [completeCopilotDeviceFlow, isPendingCopilotLoginExpired, pendingCopilotLogin, startCopilotDeviceFlow],
  );

  const cancelCopilotDeviceFlow = useCallback(async () => {
    await clearPendingCopilotLogin();
    await appendCopilotDeviceEvent("Device flow cancelled");
  }, [appendCopilotDeviceEvent, clearPendingCopilotLogin]);

  const pendingCopilotExpiresAt =
    pendingCopilotLogin && !isPendingCopilotLoginExpired(pendingCopilotLogin)
      ? new Date(Date.parse(pendingCopilotLogin.createdAt) + pendingCopilotLogin.expiresIn * 1000).toISOString()
      : undefined;

  const providerIssues = useMemo(() => {
    const issues: Partial<Record<ProviderId, string[]>> = {};

    for (const snapshot of renderedSnapshots) {
      const next: string[] = [];
      if (isUnavailableSnapshot(snapshot)) {
        const unavailableReason = snapshot.quotas.find((quota) => quota.label === "Unavailable")?.remainingDisplay;
        if (unavailableReason) {
          next.push(unavailableReason);
        }
      }

      if (snapshot.errors?.length) {
        next.push(...snapshot.errors);
      }

      if (snapshot.staleAfterSeconds !== undefined) {
        const fetchedAt = Date.parse(snapshot.fetchedAt);
        if (!Number.isNaN(fetchedAt)) {
          const staleMs = snapshot.staleAfterSeconds * 1000;
          if (Date.now() - fetchedAt > staleMs) {
            next.push(`Data is stale (older than ${Math.floor(snapshot.staleAfterSeconds / 60)} minutes).`);
          }
        }
      }

      issues[snapshot.provider] = next;
    }

    return issues;
  }, [renderedSnapshots]);

  const mainScreenProvidersTarget = (
    <MainScreenProvidersView
      visibleProviders={mainScreenProviders}
      snapshots={snapshots}
      preferences={preferences}
      refreshingProvider={refreshingProvider}
      onShowProvider={showProviderOnMainScreen}
      onHideProvider={hideProviderFromMainScreen}
      onShowAll={showAllMainScreenProviders}
      onHideAll={hideAllMainScreenProviders}
      onRefreshProvider={async (provider) => {
        await refreshProvider(provider, true);
      }}
    />
  );

  const renderProviderActions = useCallback(
    (snapshot: ProviderUsageSnapshot) => (
      <ActionPanel>
        <Action
          title={`Refresh ${PROVIDER_TITLES[snapshot.provider]}`}
          icon={Icon.ArrowClockwise}
          onAction={() => void refreshProvider(snapshot.provider, true)}
        />
        <Action title="Refresh All" icon={Icon.RotateClockwise} onAction={() => void refreshAllRemoteProviders(true)} />
        {snapshot.provider === "copilot" && (
          <Action title="Start Copilot Device Login" icon={Icon.Link} onAction={() => void startCopilotDeviceFlow()} />
        )}
        {snapshot.provider === "copilot" && pendingCopilotLogin && (
          <Action
            title="Complete Copilot Device Login"
            icon={Icon.CheckCircle}
            onAction={() => void completeCopilotDeviceFlow()}
          />
        )}
        {snapshot.provider === "copilot" && pendingCopilotLogin && (
          <Action
            title="Copy Copilot Device Code"
            icon={Icon.Clipboard}
            onAction={() => void Clipboard.copy(pendingCopilotLogin.userCode)}
          />
        )}
        {snapshot.provider === "copilot" && pendingCopilotLogin && (
          <Action.OpenInBrowser
            title="Open GitHub Device Verification"
            icon={Icon.Globe}
            url={pendingCopilotLogin.verificationUri}
          />
        )}
        {snapshot.provider === "copilot" && pendingCopilotLogin && (
          <Action
            title="Cancel Copilot Device Login"
            icon={Icon.Trash}
            onAction={() => void cancelCopilotDeviceFlow()}
          />
        )}
        {snapshot.provider === "copilot" && (
          <Action.Push
            title="Set Copilot Token"
            icon={Icon.Key}
            target={<CopilotTokenForm onSave={saveCopilotToken} />}
          />
        )}
        {snapshot.provider === "copilot" && hasStoredCopilotToken && (
          <Action
            title="Clear Stored Copilot Token"
            icon={Icon.XMarkCircle}
            onAction={() => void clearStoredCopilotToken()}
          />
        )}
        <Action
          title={`Repair ${PROVIDER_TITLES[snapshot.provider]} Auth`}
          icon={Icon.Gear}
          onAction={() => void repairProviderAuth(snapshot.provider)}
        />
        <Action.OpenInBrowser
          title={`Open ${PROVIDER_TITLES[snapshot.provider]} Usage Page`}
          icon={Icon.Globe}
          url={providerUrl(snapshot.provider, preferences)}
        />
        <Action.CopyToClipboard
          title={`Copy ${PROVIDER_TITLES[snapshot.provider]} Debug Bundle`}
          icon={Icon.Clipboard}
          content={JSON.stringify(redactSensitive(snapshot), null, 2)}
        />
        <Action.Push title="Edit Main Screen Providers" icon={Icon.List} target={mainScreenProvidersTarget} />
        <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
      </ActionPanel>
    ),
    [
      cancelCopilotDeviceFlow,
      clearStoredCopilotToken,
      completeCopilotDeviceFlow,
      hasStoredCopilotToken,
      mainScreenProvidersTarget,
      pendingCopilotLogin,
      preferences,
      refreshAllRemoteProviders,
      refreshProvider,
      repairProviderAuth,
      saveCopilotToken,
      startCopilotDeviceFlow,
    ],
  );

  const renderProviderDetail = useCallback(
    (snapshot: ProviderUsageSnapshot) => (
      <ProviderDetailView
        snapshot={snapshot}
        issues={providerIssues[snapshot.provider] ?? []}
        isRefreshing={isRefreshingAll || refreshingProvider === snapshot.provider}
        pendingCopilotLogin={snapshot.provider === "copilot" ? pendingCopilotLogin : undefined}
        pendingCopilotExpiresAt={snapshot.provider === "copilot" ? pendingCopilotExpiresAt : undefined}
        renderActions={renderProviderActions}
      />
    ),
    [
      isRefreshingAll,
      pendingCopilotExpiresAt,
      pendingCopilotLogin,
      providerIssues,
      refreshingProvider,
      renderProviderActions,
    ],
  );

  const isBusy = isLoading || isRefreshingAll;

  if (!isBusy && renderedSnapshots.length === 0) {
    return (
      <List isLoading={isBusy} searchBarPlaceholder="Search providers...">
        <List.EmptyView
          icon={Icon.List}
          title="No Main Screen Providers Selected"
          description="Choose which providers should appear on the main screen."
          actions={
            <ActionPanel>
              <Action.Push title="Choose Main Screen Providers" icon={Icon.List} target={mainScreenProvidersTarget} />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isBusy} searchBarPlaceholder="Search providers...">
      <List.Section title="Providers" subtitle={`${renderedSnapshots.length} visible`}>
        {renderedSnapshots.map((snapshot) => {
          const summary = summarizeProviderSnapshot(snapshot);

          return (
            <List.Item
              key={snapshot.provider}
              icon={statusIcon(summary.status)}
              title={summary.title}
              subtitle={summary.subtitle}
              actions={
                <ActionPanel>
                  <Action.Push
                    title={`Open ${PROVIDER_TITLES[snapshot.provider]} Details`}
                    icon={Icon.List}
                    target={renderProviderDetail(snapshot)}
                  />
                  <Action
                    title={`Refresh ${PROVIDER_TITLES[snapshot.provider]}`}
                    icon={Icon.ArrowClockwise}
                    onAction={() => void refreshProvider(snapshot.provider, true)}
                  />
                  <Action
                    title="Refresh All"
                    icon={Icon.RotateClockwise}
                    onAction={() => void refreshAllRemoteProviders(true)}
                  />
                  <Action.Push
                    title="Choose Main Screen Providers"
                    icon={Icon.List}
                    target={mainScreenProvidersTarget}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
      <List.Section
        title="Status"
        subtitle={lastRefreshAt ? `Last full refresh ${formatRelativeTimestamp(lastRefreshAt)}` : "No refresh yet"}
      >
        <List.Item
          icon={Icon.Clock}
          title="Dashboard"
          subtitle={
            isRefreshingAll
              ? "Refreshing all providers..."
              : refreshingProvider
                ? `Refreshing ${PROVIDER_TITLES[refreshingProvider]}...`
                : "Ready"
          }
          actions={
            <ActionPanel>
              <Action
                title="Refresh All"
                icon={Icon.ArrowClockwise}
                onAction={() => void refreshAllRemoteProviders(true)}
              />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.List}
          title="Main Screen Providers"
          subtitle={`${mainScreenProviders.length} visible of ${PROVIDER_ORDER.length} total`}
          actions={
            <ActionPanel>
              <Action.Push title="Choose Main Screen Providers" icon={Icon.List} target={mainScreenProvidersTarget} />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={statusIcon(
            samplerFailureEntries.length > 0 ? "warning" : samplerSkipEntries.length > 0 ? "unknown" : "ok",
          )}
          title="Background Sampler"
          subtitle={samplerSubtitle}
          actions={
            <ActionPanel>
              <Action
                title="Run Background Sampler Now"
                icon={Icon.Clock}
                onAction={() => void runBackgroundSampler()}
              />
              <Action.CopyToClipboard
                title="Copy Sampler Status"
                icon={Icon.Clipboard}
                content={JSON.stringify(samplerStatus ?? {}, null, 2)}
              />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
        {samplerFailureEntries.map((entry) => (
          <List.Item
            key={`sampler-${entry.provider}`}
            icon={statusIcon("warning")}
            title={`Sampler Issue: ${PROVIDER_TITLES[entry.provider]}`}
            subtitle={entry.message}
            actions={
              <ActionPanel>
                <Action
                  title={`Refresh ${PROVIDER_TITLES[entry.provider]}`}
                  icon={Icon.ArrowClockwise}
                  onAction={() => void refreshProvider(entry.provider, true)}
                />
                <Action
                  title="Run Background Sampler Now"
                  icon={Icon.Clock}
                  onAction={() => void runBackgroundSampler()}
                />
                <Action.CopyToClipboard title="Copy Issue Message" icon={Icon.Clipboard} content={entry.message} />
                <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
              </ActionPanel>
            }
          />
        ))}
        {samplerSkipEntries.map((entry) => (
          <List.Item
            key={`sampler-skip-${entry.provider}`}
            icon={statusIcon("unknown")}
            title={`Sampler Skipped: ${PROVIDER_TITLES[entry.provider]}`}
            subtitle={entry.message}
            actions={
              <ActionPanel>
                <Action
                  title={`Refresh ${PROVIDER_TITLES[entry.provider]}`}
                  icon={Icon.ArrowClockwise}
                  onAction={() => void refreshProvider(entry.provider, true)}
                />
                <Action
                  title="Run Background Sampler Now"
                  icon={Icon.Clock}
                  onAction={() => void runBackgroundSampler()}
                />
                <Action.CopyToClipboard title="Copy Skip Message" icon={Icon.Clipboard} content={entry.message} />
                <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
