import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  List,
  LocalStorage,
  Toast,
  getPreferenceValues,
  open,
  openExtensionPreferences,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderDetailView, PendingCopilotDeviceLogin } from "./components/provider-detail-view";
import {
  isUnavailableSnapshot,
  CORE_PROVIDERS,
  OPTIONAL_PROVIDERS,
  PROVIDER_ORDER,
  refreshAllProviders,
  refreshSingleProvider,
  SnapshotMap,
  summarizeProviderSnapshot,
} from "./lib/dashboard";
import { formatRelativeTimestamp } from "./lib/date";
import { statusIcon } from "./lib/format";
import { mergeQuotaHistory } from "./lib/history";
import { redactSensitive } from "./lib/redact";
import { fetchProviderStatus, ProviderStatusSnapshot, statusEndpointForProvider } from "./lib/status";
import { loadDashboardState, mapSnapshotsByProvider, saveDashboardState } from "./lib/storage";
import { ProviderId, ProviderUsageSnapshot } from "./models/usage";
import { fetchClaudeSnapshot } from "./providers/claude";
import { fetchCodexSnapshot } from "./providers/codex";
import { fetchCopilotSnapshot, pollCopilotDeviceToken, requestCopilotDeviceCode } from "./providers/copilot";
import { fetchCursorSnapshot } from "./providers/cursor";
import { fetchGeminiSnapshot } from "./providers/gemini";
import { fetchAntigravitySnapshot } from "./providers/antigravity";
import { fetchOpenRouterSnapshot } from "./providers/openrouter";
import { fetchZaiSnapshot } from "./providers/zai";
import { fetchKimiK2Snapshot } from "./providers/kimi-k2";
import { fetchAmpSnapshot } from "./providers/amp";
import { fetchMiniMaxSnapshot } from "./providers/minimax";
import { fetchOpenCodeSnapshot } from "./providers/opencode";

const COPILOT_TOKEN_STORAGE_KEY = "agent-usage.copilot.device-token.v1";
const COPILOT_DEVICE_PENDING_KEY = "agent-usage.copilot.device-pending.v1";
const COPILOT_LAST_SUCCESS_KEY = "agent-usage.copilot.last-success-at.v1";
const COPILOT_DEVICE_EVENTS_KEY = "agent-usage.copilot.device-events.v1";
const OPTIONAL_PROVIDERS_KEY = "agent-usage.optional-providers.v1";
const CURSOR_COOKIE_CACHE_KEY = "agent-usage.cursor.cookie-cache.v1";
const AMP_COOKIE_CACHE_KEY = "agent-usage.amp.cookie-cache.v1";
const OPENCODE_COOKIE_CACHE_KEY = "agent-usage.opencode.cookie-cache.v1";
const MINIMAX_COOKIE_CACHE_KEY = "agent-usage.minimax.cookie-cache.v1";
const PROVIDER_STATUS_CACHE_TTL_MS = 15 * 60 * 1000;

interface Preferences {
  codexAuthToken?: string;
  claudeAccessToken?: string;
  geminiAccessToken?: string;
  antigravityCsrfToken?: string;
  antigravityServerUrl?: string;
  checkProviderStatus?: boolean;
  copilotApiToken?: string;
  cursorCookieHeader?: string;
  cursorCookieSourceMode?: "auto" | "manual";
  openrouterApiKey?: string;
  openrouterApiBaseUrl?: string;
  zaiApiKey?: string;
  zaiQuotaUrl?: string;
  kimiK2ApiKey?: string;
  ampCookieHeader?: string;
  ampCookieSourceMode?: "auto" | "manual";
  minimaxApiKey?: string;
  minimaxCookieHeader?: string;
  minimaxCookieSourceMode?: "auto" | "manual";
  opencodeCookieHeader?: string;
  opencodeCookieSourceMode?: "auto" | "manual";
  opencodeWorkspaceId?: string;
  codexUsageUrl?: string;
  claudeUsageUrl?: string;
  geminiUsageUrl?: string;
  antigravityUsageUrl?: string;
  copilotUsageUrl?: string;
  cursorUsageUrl?: string;
  openrouterUsageUrl?: string;
  zaiUsageUrl?: string;
  kimiK2UsageUrl?: string;
  ampUsageUrl?: string;
  minimaxUsageUrl?: string;
  opencodeUsageUrl?: string;
}

interface CopilotTokenFormValues {
  token: string;
}

type OptionalProvidersFormValues = Partial<Record<ProviderId, boolean>>;

interface CopilotTokenFormProps {
  onSave: (token: string) => Promise<void>;
}

const PROVIDER_TITLES: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  antigravity: "Antigravity",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  openrouter: "OpenRouter",
  zai: "z.ai",
  "kimi-k2": "Kimi K2",
  amp: "Amp",
  minimax: "MiniMax",
  opencode: "OpenCode",
};

function buildFallbackSnapshot(provider: ProviderId, reason: string): ProviderUsageSnapshot {
  return {
    provider,
    fetchedAt: new Date().toISOString(),
    quotas: [
      {
        id: `${provider}-placeholder`,
        label: "Unavailable",
        remainingDisplay: reason,
        status: "unknown",
      },
    ],
    source: "manual",
  };
}

function providerUrl(provider: ProviderId, preferences: Preferences): string {
  if (provider === "codex") {
    return preferences.codexUsageUrl?.trim() || "https://chatgpt.com/codex/settings/usage";
  }

  if (provider === "claude") {
    return preferences.claudeUsageUrl?.trim() || "https://claude.ai/settings/usage";
  }

  if (provider === "gemini") {
    return preferences.geminiUsageUrl?.trim() || "https://aistudio.google.com/app/plan";
  }

  if (provider === "antigravity") {
    return (
      preferences.antigravityUsageUrl?.trim() || preferences.antigravityServerUrl?.trim() || "https://antigravity.dev"
    );
  }

  if (provider === "cursor") {
    return preferences.cursorUsageUrl?.trim() || "https://cursor.com/dashboard";
  }

  if (provider === "openrouter") {
    return preferences.openrouterUsageUrl?.trim() || "https://openrouter.ai/settings/credits";
  }

  if (provider === "zai") {
    return preferences.zaiUsageUrl?.trim() || "https://z.ai/manage-apikey/subscription";
  }

  if (provider === "kimi-k2") {
    return preferences.kimiK2UsageUrl?.trim() || "https://kimi-k2.ai";
  }

  if (provider === "amp") {
    return preferences.ampUsageUrl?.trim() || "https://ampcode.com/settings";
  }

  if (provider === "minimax") {
    return preferences.minimaxUsageUrl?.trim() || "https://platform.minimax.io/user-center/payment/coding-plan";
  }

  if (provider === "opencode") {
    return preferences.opencodeUsageUrl?.trim() || "https://opencode.ai";
  }

  return preferences.copilotUsageUrl?.trim() || "https://github.com/settings/copilot";
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

interface OptionalProvidersFormProps {
  enabledProviders: ProviderId[];
  onSave: (providers: ProviderId[]) => Promise<void>;
}

function OptionalProvidersForm({ enabledProviders, onSave }: OptionalProvidersFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const enabledSet = new Set(enabledProviders);

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Optional Providers"
            icon={Icon.CheckCircle}
            onSubmit={async (values: OptionalProvidersFormValues) => {
              setIsSubmitting(true);
              try {
                const nextEnabled = OPTIONAL_PROVIDERS.filter((provider) => values[provider] === true);
                await onSave(nextEnabled);
                await popToRoot();
              } finally {
                setIsSubmitting(false);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Optional Providers"
        text="Optional providers stay hidden until enabled here or credentials are configured."
      />
      {OPTIONAL_PROVIDERS.map((provider) => (
        <Form.Checkbox
          key={provider}
          id={provider}
          label={PROVIDER_TITLES[provider]}
          title={PROVIDER_TITLES[provider]}
          defaultValue={enabledSet.has(provider)}
        />
      ))}
    </Form>
  );
}

function parseOptionalProviders(raw: string | undefined): ProviderId[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is ProviderId => typeof entry === "string" && OPTIONAL_PROVIDERS.includes(entry as ProviderId),
    );
  } catch {
    return [];
  }
}

function providerHasConfiguredAuth(provider: ProviderId, preferences: Preferences): boolean {
  if (provider === "openrouter") {
    return !!(preferences.openrouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim());
  }
  if (provider === "zai") {
    return !!(preferences.zaiApiKey?.trim() || process.env.Z_AI_API_KEY?.trim());
  }
  if (provider === "kimi-k2") {
    return !!(
      preferences.kimiK2ApiKey?.trim() ||
      process.env.KIMI_K2_API_KEY?.trim() ||
      process.env.KIMI_API_KEY?.trim()
    );
  }
  if (provider === "amp") {
    return !!(
      preferences.ampCookieHeader?.trim() ||
      process.env.AMP_COOKIE_HEADER?.trim() ||
      process.env.AMP_COOKIE?.trim()
    );
  }
  if (provider === "minimax") {
    return !!(
      preferences.minimaxApiKey?.trim() ||
      preferences.minimaxCookieHeader?.trim() ||
      process.env.MINIMAX_API_KEY?.trim() ||
      process.env.MINIMAX_COOKIE_HEADER?.trim() ||
      process.env.MINIMAX_COOKIE?.trim()
    );
  }
  if (provider === "opencode") {
    return !!(
      preferences.opencodeCookieHeader?.trim() ||
      process.env.OPENCODE_COOKIE_HEADER?.trim() ||
      process.env.OPENCODE_COOKIE?.trim()
    );
  }
  return true;
}

function hasSuccessfulSnapshot(snapshot: ProviderUsageSnapshot | undefined): boolean {
  if (!snapshot) {
    return false;
  }
  return !isUnavailableSnapshot(snapshot);
}

function resolveVisibleProviderOrder(
  enabledOptionalProviders: ProviderId[],
  preferences: Preferences,
  snapshots: SnapshotMap,
): ProviderId[] {
  const enabledSet = new Set(enabledOptionalProviders);
  const visibleOptional = OPTIONAL_PROVIDERS.filter((provider) => {
    if (enabledSet.has(provider)) {
      return true;
    }
    if (providerHasConfiguredAuth(provider, preferences)) {
      return true;
    }
    if (hasSuccessfulSnapshot(snapshots[provider])) {
      return true;
    }
    return false;
  });

  return [...CORE_PROVIDERS, ...visibleOptional];
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [enabledOptionalProviders, setEnabledOptionalProviders] = useState<ProviderId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState<ProviderId | undefined>();
  const [lastRefreshAt, setLastRefreshAt] = useState<string | undefined>();
  const snapshotsRef = useRef<SnapshotMap>({});
  const visibleProviderOrderRef = useRef<ProviderId[]>(CORE_PROVIDERS);
  const hasHydratedRef = useRef(false);
  const copilotTokenRef = useRef<string | undefined>(undefined);
  const cursorCookieCacheRef = useRef<string | undefined>(undefined);
  const ampCookieCacheRef = useRef<string | undefined>(undefined);
  const opencodeCookieCacheRef = useRef<string | undefined>(undefined);
  const minimaxCookieCacheRef = useRef<string | undefined>(undefined);
  const providerStatusCacheRef = useRef<Partial<Record<ProviderId, ProviderStatusSnapshot>>>({});
  const [copilotTokenState, setCopilotTokenState] = useState<string | undefined>();
  const [pendingCopilotLogin, setPendingCopilotLogin] = useState<PendingCopilotDeviceLogin | undefined>();
  const [copilotLastSuccessAt, setCopilotLastSuccessAt] = useState<string | undefined>();
  const [copilotDeviceEvents, setCopilotDeviceEvents] = useState<string[]>([]);

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

  const visibleProviderOrder = useMemo(() => {
    return resolveVisibleProviderOrder(enabledOptionalProviders, preferences, snapshots);
  }, [enabledOptionalProviders, preferences, snapshots]);

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
    const ordered = PROVIDER_ORDER.map((providerId) => next[providerId]).filter(
      (snapshot): snapshot is ProviderUsageSnapshot => !!snapshot,
    );

    await saveDashboardState({
      snapshots: ordered,
      lastRefreshAt: refreshAt,
    });
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

      if (provider === "claude") {
        return withStatus(await fetchClaudeSnapshot(preferences.claudeAccessToken));
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
      preferences.checkProviderStatus,
      preferences.codexAuthToken,
      preferences.copilotApiToken,
      preferences.cursorCookieHeader,
      preferences.cursorCookieSourceMode,
      preferences.geminiAccessToken,
      preferences.antigravityServerUrl,
      preferences.antigravityCsrfToken,
      preferences.openrouterApiKey,
      preferences.openrouterApiBaseUrl,
      preferences.zaiApiKey,
      preferences.zaiQuotaUrl,
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
        const mergedSnapshot: ProviderUsageSnapshot = {
          ...result.snapshot,
          quotaHistory: mergeQuotaHistory(snapshotsRef.current[provider], result.snapshot, result.refreshedAt),
        };
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
        const mergedSnapshots: SnapshotMap = { ...result.snapshots };
        for (const providerId of providerOrder) {
          const candidate = result.snapshots[providerId];
          if (!candidate) {
            continue;
          }
          mergedSnapshots[providerId] = {
            ...candidate,
            quotaHistory: mergeQuotaHistory(snapshotsRef.current[providerId], candidate, result.refreshedAt),
          };
        }

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

  const saveOptionalProviders = useCallback(
    async (providers: ProviderId[]) => {
      const normalized = OPTIONAL_PROVIDERS.filter((provider) => providers.includes(provider));
      setEnabledOptionalProviders(normalized);
      visibleProviderOrderRef.current = resolveVisibleProviderOrder(normalized, preferences, snapshotsRef.current);
      await LocalStorage.setItem(OPTIONAL_PROVIDERS_KEY, JSON.stringify(normalized));
      await showToast({
        title: "Optional providers updated",
        message: `${normalized.length} enabled`,
        style: Toast.Style.Success,
      });
      await refreshAllRemoteProviders(false);
    },
    [preferences, refreshAllRemoteProviders],
  );

  const startCopilotDeviceFlow = useCallback(async () => {
    const startingToast = await showToast({
      title: "Starting Copilot login",
      message: "Requesting GitHub device code...",
      style: Toast.Style.Animated,
    });

    try {
      await appendCopilotDeviceEvent("Device flow started");
      const device = await requestCopilotDeviceCode();
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
  }, [appendCopilotDeviceEvent, refreshProvider]);

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
      const token = await pollCopilotDeviceToken(pending);
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
        storedOptionalProviders,
        storedCursorCookie,
        storedAmpCookie,
        storedOpenCodeCookie,
        storedMiniMaxCookie,
      ] = await Promise.all([
        loadDashboardState(),
        LocalStorage.getItem<string>(COPILOT_TOKEN_STORAGE_KEY),
        LocalStorage.getItem<string>(COPILOT_DEVICE_PENDING_KEY),
        LocalStorage.getItem<string>(COPILOT_LAST_SUCCESS_KEY),
        LocalStorage.getItem<string>(COPILOT_DEVICE_EVENTS_KEY),
        LocalStorage.getItem<string>(OPTIONAL_PROVIDERS_KEY),
        LocalStorage.getItem<string>(CURSOR_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(AMP_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(OPENCODE_COOKIE_CACHE_KEY),
        LocalStorage.getItem<string>(MINIMAX_COOKIE_CACHE_KEY),
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

      cursorCookieCacheRef.current = storedCursorCookie?.trim();
      ampCookieCacheRef.current = storedAmpCookie?.trim();
      opencodeCookieCacheRef.current = storedOpenCodeCookie?.trim();
      minimaxCookieCacheRef.current = storedMiniMaxCookie?.trim();

      const initialSnapshots = state?.snapshots?.length ? mapSnapshotsByProvider(state.snapshots) : {};
      if (state?.snapshots?.length) {
        setSnapshots(initialSnapshots);
        setLastRefreshAt(state.lastRefreshAt);
      }

      const initialOptionalProviders = parseOptionalProviders(storedOptionalProviders);
      setEnabledOptionalProviders(initialOptionalProviders);
      visibleProviderOrderRef.current = resolveVisibleProviderOrder(
        initialOptionalProviders,
        preferences,
        initialSnapshots,
      );

      setIsLoading(false);
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

      return buildFallbackSnapshot("copilot", "Start Copilot Device Login, then Complete Copilot Device Login.");
    });
  }, [snapshots, visibleProviderOrder]);

  const hasStoredCopilotToken = !!copilotTokenState?.trim();
  const configuredOptionalCount = useMemo(
    () => OPTIONAL_PROVIDERS.filter((provider) => providerHasConfiguredAuth(provider, preferences)).length,
    [preferences],
  );
  const visibleOptionalCount = Math.max(0, visibleProviderOrder.length - CORE_PROVIDERS.length);

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
        <Action.Push
          title="Manage Optional Providers"
          icon={Icon.List}
          target={<OptionalProvidersForm enabledProviders={enabledOptionalProviders} onSave={saveOptionalProviders} />}
        />
        <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
      </ActionPanel>
    ),
    [
      cancelCopilotDeviceFlow,
      clearStoredCopilotToken,
      completeCopilotDeviceFlow,
      enabledOptionalProviders,
      hasStoredCopilotToken,
      pendingCopilotLogin,
      preferences,
      refreshAllRemoteProviders,
      refreshProvider,
      repairProviderAuth,
      saveOptionalProviders,
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

  return (
    <List isLoading={isBusy} searchBarPlaceholder="Search providers...">
      <List.Section title="Providers" subtitle={`${renderedSnapshots.length} providers`}>
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
                    title="Manage Optional Providers"
                    icon={Icon.List}
                    target={
                      <OptionalProvidersForm
                        enabledProviders={enabledOptionalProviders}
                        onSave={saveOptionalProviders}
                      />
                    }
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
          title="Optional Providers"
          subtitle={`${visibleOptionalCount} visible, ${enabledOptionalProviders.length} manually enabled, ${configuredOptionalCount} configured`}
          actions={
            <ActionPanel>
              <Action.Push
                title="Manage Optional Providers"
                icon={Icon.List}
                target={
                  <OptionalProvidersForm enabledProviders={enabledOptionalProviders} onSave={saveOptionalProviders} />
                }
              />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}
