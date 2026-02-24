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
import { loadDashboardState, mapSnapshotsByProvider, saveDashboardState } from "./lib/storage";
import { ProviderId, ProviderUsageSnapshot } from "./models/usage";
import { fetchClaudeSnapshot } from "./providers/claude";
import { fetchCodexSnapshot } from "./providers/codex";
import { fetchCopilotSnapshot, pollCopilotDeviceToken, requestCopilotDeviceCode } from "./providers/copilot";
import { fetchCursorSnapshot } from "./providers/cursor";
import { fetchGeminiSnapshot } from "./providers/gemini";
import { fetchAntigravitySnapshot } from "./providers/antigravity";

const COPILOT_TOKEN_STORAGE_KEY = "agent-usage.copilot.device-token.v1";
const COPILOT_DEVICE_PENDING_KEY = "agent-usage.copilot.device-pending.v1";
const COPILOT_LAST_SUCCESS_KEY = "agent-usage.copilot.last-success-at.v1";
const COPILOT_DEVICE_EVENTS_KEY = "agent-usage.copilot.device-events.v1";

interface Preferences {
  codexAuthToken?: string;
  claudeAccessToken?: string;
  geminiAccessToken?: string;
  antigravityCsrfToken?: string;
  antigravityServerUrl?: string;
  copilotApiToken?: string;
  cursorCookieHeader?: string;
  codexUsageUrl?: string;
  claudeUsageUrl?: string;
  geminiUsageUrl?: string;
  antigravityUsageUrl?: string;
  copilotUsageUrl?: string;
  cursorUsageUrl?: string;
}

interface CopilotTokenFormValues {
  token: string;
}

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

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState<ProviderId | undefined>();
  const [lastRefreshAt, setLastRefreshAt] = useState<string | undefined>();
  const snapshotsRef = useRef<SnapshotMap>({});
  const copilotTokenRef = useRef<string | undefined>(undefined);
  const [copilotTokenState, setCopilotTokenState] = useState<string | undefined>();
  const [pendingCopilotLogin, setPendingCopilotLogin] = useState<PendingCopilotDeviceLogin | undefined>();
  const [copilotLastSuccessAt, setCopilotLastSuccessAt] = useState<string | undefined>();
  const [copilotDeviceEvents, setCopilotDeviceEvents] = useState<string[]>([]);

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

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

  const fetchProviderSnapshot = useCallback(
    async (provider: ProviderId): Promise<ProviderUsageSnapshot> => {
      if (provider === "codex") {
        return fetchCodexSnapshot(preferences.codexAuthToken);
      }

      if (provider === "claude") {
        return fetchClaudeSnapshot(preferences.claudeAccessToken);
      }

      if (provider === "cursor") {
        return fetchCursorSnapshot(preferences.cursorCookieHeader);
      }

      if (provider === "gemini") {
        return fetchGeminiSnapshot(preferences.geminiAccessToken);
      }

      if (provider === "antigravity") {
        return fetchAntigravitySnapshot(preferences.antigravityServerUrl, preferences.antigravityCsrfToken);
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
      return fetchCopilotSnapshot(copilotToken, {
        tokenSource,
        lastSuccessAt: copilotLastSuccessAt,
        recentDeviceEvents: copilotDeviceEvents.slice(0, 3),
      });
    },
    [
      copilotDeviceEvents,
      copilotLastSuccessAt,
      isPendingCopilotLoginExpired,
      pendingCopilotLogin,
      preferences.claudeAccessToken,
      preferences.codexAuthToken,
      preferences.copilotApiToken,
      preferences.cursorCookieHeader,
      preferences.geminiAccessToken,
      preferences.antigravityServerUrl,
      preferences.antigravityCsrfToken,
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
        const result = await refreshAllProviders(
          snapshotsRef.current,
          fetchProviderSnapshot,
          fallbackSnapshotForProvider,
        );
        const mergedSnapshots: SnapshotMap = { ...result.snapshots };
        for (const providerId of PROVIDER_ORDER) {
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
    async function hydrate() {
      const [state, storedCopilotToken, storedPendingRaw, storedCopilotSuccess, storedCopilotEvents] =
        await Promise.all([
          loadDashboardState(),
          LocalStorage.getItem<string>(COPILOT_TOKEN_STORAGE_KEY),
          LocalStorage.getItem<string>(COPILOT_DEVICE_PENDING_KEY),
          LocalStorage.getItem<string>(COPILOT_LAST_SUCCESS_KEY),
          LocalStorage.getItem<string>(COPILOT_DEVICE_EVENTS_KEY),
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

      if (state?.snapshots?.length) {
        setSnapshots(mapSnapshotsByProvider(state.snapshots));
        setLastRefreshAt(state.lastRefreshAt);
      }

      setIsLoading(false);
      await refreshAllRemoteProviders(false);
    }

    void hydrate();
  }, [isPendingCopilotLoginExpired, refreshAllRemoteProviders]);

  const renderedSnapshots = useMemo(() => {
    return PROVIDER_ORDER.map((providerId) => {
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
          "Set Cursor Cookie Header in extension preferences from a valid cursor.com session.",
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

      return buildFallbackSnapshot("copilot", "Start Copilot Device Login, then Complete Copilot Device Login.");
    });
  }, [snapshots]);

  const hasStoredCopilotToken = !!copilotTokenState?.trim();

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
          message: "Set Cursor Cookie Header from an active cursor.com session, then refresh.",
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
        <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
      </ActionPanel>
    ),
    [
      cancelCopilotDeviceFlow,
      clearStoredCopilotToken,
      completeCopilotDeviceFlow,
      hasStoredCopilotToken,
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
      </List.Section>
    </List>
  );
}
