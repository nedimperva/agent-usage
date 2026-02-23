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
import { formatRelativeTimestamp } from "./lib/date";
import { quotaAccessories, quotaProgressIcon, statusIcon } from "./lib/format";
import { loadDashboardState, mapSnapshotsByProvider, saveDashboardState } from "./lib/storage";
import { ProviderId, ProviderUsageSnapshot } from "./models/usage";
import { fetchClaudeSnapshot } from "./providers/claude";
import { fetchCodexSnapshot, parseCodexImport } from "./providers/codex";
import { fetchCopilotSnapshot, pollCopilotDeviceToken, requestCopilotDeviceCode } from "./providers/copilot";

const COPILOT_TOKEN_STORAGE_KEY = "agent-usage.copilot.device-token.v1";
const COPILOT_DEVICE_PENDING_KEY = "agent-usage.copilot.device-pending.v1";

interface Preferences {
  codexAuthToken?: string;
  claudeAccessToken?: string;
  copilotApiToken?: string;
  codexUsageUrl?: string;
  claudeUsageUrl?: string;
  copilotUsageUrl?: string;
}

interface CodexImportFormValues {
  payload: string;
}

interface CodexImportFormProps {
  onImport: (payload: string) => Promise<void>;
}

interface CopilotTokenFormValues {
  token: string;
}

interface CopilotTokenFormProps {
  onSave: (token: string) => Promise<void>;
}

interface PendingCopilotDeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  createdAt: string;
}

const PROVIDER_ORDER: ProviderId[] = ["codex", "copilot", "claude"];

const PROVIDER_TITLES: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
  copilot: "GitHub Copilot",
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

  return preferences.copilotUsageUrl?.trim() || "https://github.com/settings/copilot";
}

function sectionTitle(snapshot: ProviderUsageSnapshot): string {
  const base = PROVIDER_TITLES[snapshot.provider];
  return snapshot.planLabel ? `${base} (${snapshot.planLabel})` : base;
}

function CodexImportForm({ onImport }: CodexImportFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Import Usage"
            icon={Icon.Upload}
            onSubmit={async (values: CodexImportFormValues) => {
              setIsSubmitting(true);
              try {
                await onImport(values.payload);
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
        title="Codex Usage Import"
        text="Fallback import: paste JSON or `Label: 68% left +10% reset Feb 25` lines."
      />
      <Form.TextArea
        id="payload"
        title="Usage Payload"
        placeholder='{"quotas":[{"label":"Weekly Limit","remainingPercent":68}]}'
      />
    </Form>
  );
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
  const [snapshots, setSnapshots] = useState<Partial<Record<ProviderId, ProviderUsageSnapshot>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | undefined>();
  const snapshotsRef = useRef<Partial<Record<ProviderId, ProviderUsageSnapshot>>>({});
  const copilotTokenRef = useRef<string | undefined>(undefined);
  const [copilotTokenState, setCopilotTokenState] = useState<string | undefined>();
  const [pendingCopilotLogin, setPendingCopilotLogin] = useState<PendingCopilotDeviceLogin | undefined>();

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

  const persistSnapshots = useCallback(
    async (next: Partial<Record<ProviderId, ProviderUsageSnapshot>>, refreshAt?: string) => {
      const ordered = PROVIDER_ORDER.map((providerId) => next[providerId]).filter(
        (snapshot): snapshot is ProviderUsageSnapshot => !!snapshot,
      );

      await saveDashboardState({
        snapshots: ordered,
        lastRefreshAt: refreshAt,
      });
    },
    [],
  );

  const resolveCopilotToken = useCallback((): string | undefined => {
    const preferenceToken = preferences.copilotApiToken?.trim();
    if (preferenceToken) {
      return preferenceToken;
    }
    return copilotTokenRef.current?.trim();
  }, [preferences.copilotApiToken]);

  const refreshRemoteProviders = useCallback(
    async (showSuccess = false) => {
      setIsRefreshing(true);
      try {
        const next: Partial<Record<ProviderId, ProviderUsageSnapshot>> = { ...snapshotsRef.current };
        const now = new Date().toISOString();

        try {
          next.codex = await fetchCodexSnapshot(preferences.codexAuthToken);
        } catch (error) {
          next.codex = buildFallbackSnapshot(
            "codex",
            error instanceof Error ? error.message : "Codex usage request failed.",
          );
        }

        try {
          next.claude = await fetchClaudeSnapshot(preferences.claudeAccessToken);
        } catch (error) {
          next.claude = buildFallbackSnapshot(
            "claude",
            error instanceof Error ? error.message : "Claude usage request failed.",
          );
        }

        const copilotToken = resolveCopilotToken();
        if (copilotToken) {
          try {
            next.copilot = await fetchCopilotSnapshot(copilotToken);
          } catch (error) {
            next.copilot = buildFallbackSnapshot(
              "copilot",
              error instanceof Error ? error.message : "Copilot usage request failed.",
            );
          }
        } else {
          const pending = pendingCopilotLogin;
          const activePending = pending && !isPendingCopilotLoginExpired(pending);
          next.copilot = buildFallbackSnapshot(
            "copilot",
            activePending
              ? `Device code ${pending.userCode} pending. Complete login, then run Complete Copilot Device Login.`
              : "No Copilot token configured. Start Copilot Device Login.",
          );
        }

        setSnapshots(next);
        snapshotsRef.current = next;
        setLastRefreshAt(now);
        await persistSnapshots(next, now);

        if (showSuccess) {
          await showToast({
            title: "Usage Refreshed",
            style: Toast.Style.Success,
          });
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [
      isPendingCopilotLoginExpired,
      pendingCopilotLogin,
      persistSnapshots,
      preferences.claudeAccessToken,
      preferences.codexAuthToken,
      resolveCopilotToken,
    ],
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
      await refreshRemoteProviders(false);
    },
    [refreshRemoteProviders],
  );

  const clearStoredCopilotToken = useCallback(async () => {
    await LocalStorage.removeItem(COPILOT_TOKEN_STORAGE_KEY);
    copilotTokenRef.current = undefined;
    setCopilotTokenState(undefined);
    await showToast({
      title: "Stored Copilot token removed",
      style: Toast.Style.Success,
    });
    await refreshRemoteProviders(false);
  }, [refreshRemoteProviders]);

  const startCopilotDeviceFlow = useCallback(async () => {
    const startingToast = await showToast({
      title: "Starting Copilot login",
      message: "Requesting GitHub device code...",
      style: Toast.Style.Animated,
    });

    try {
      const device = await requestCopilotDeviceCode();
      const pending: PendingCopilotDeviceLogin = {
        ...device,
        createdAt: new Date().toISOString(),
      };

      await LocalStorage.setItem(COPILOT_DEVICE_PENDING_KEY, JSON.stringify(pending));
      setPendingCopilotLogin(pending);
      await Clipboard.copy(pending.userCode);
      await open(pending.verificationUri);

      startingToast.style = Toast.Style.Success;
      startingToast.title = "Copilot code ready";
      startingToast.message = `Code ${pending.userCode} copied. Paste on GitHub page, then run Complete Copilot Device Login.`;
    } catch (error) {
      startingToast.style = Toast.Style.Failure;
      startingToast.title = "Copilot login failed";
      startingToast.message = error instanceof Error ? error.message : "Unknown device flow error.";
    }
  }, []);

  const completeCopilotDeviceFlow = useCallback(async () => {
    const pending = pendingCopilotLogin;
    if (!pending) {
      await showToast({
        title: "No pending login",
        message: "Run Start Copilot Device Login first.",
        style: Toast.Style.Failure,
      });
      return;
    }

    if (isPendingCopilotLoginExpired(pending)) {
      await clearPendingCopilotLogin();
      await showToast({
        title: "Device code expired",
        message: "Start Copilot Device Login again.",
        style: Toast.Style.Failure,
      });
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
      await refreshRemoteProviders(false);
    } catch (error) {
      waitingToast.style = Toast.Style.Failure;
      waitingToast.title = "Copilot login failed";
      waitingToast.message = error instanceof Error ? error.message : "Unknown device flow error.";
    }
  }, [clearPendingCopilotLogin, isPendingCopilotLoginExpired, pendingCopilotLogin, refreshRemoteProviders]);

  const importCodexPayload = useCallback(
    async (payload: string) => {
      try {
        const codexSnapshot = parseCodexImport(payload);
        const next = { ...snapshotsRef.current, codex: codexSnapshot };
        setSnapshots(next);
        snapshotsRef.current = next;
        await persistSnapshots(next, lastRefreshAt);
        await showToast({
          title: "Codex usage imported",
          style: Toast.Style.Success,
        });
      } catch (error) {
        await showToast({
          title: "Codex import failed",
          message: error instanceof Error ? error.message : "Unknown import error.",
          style: Toast.Style.Failure,
        });
        throw error;
      }
    },
    [lastRefreshAt, persistSnapshots],
  );

  useEffect(() => {
    async function hydrate() {
      const [state, storedCopilotToken, storedPendingRaw] = await Promise.all([
        loadDashboardState(),
        LocalStorage.getItem<string>(COPILOT_TOKEN_STORAGE_KEY),
        LocalStorage.getItem<string>(COPILOT_DEVICE_PENDING_KEY),
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

      if (state?.snapshots?.length) {
        setSnapshots(mapSnapshotsByProvider(state.snapshots));
        setLastRefreshAt(state.lastRefreshAt);
      }

      setIsLoading(false);
      await refreshRemoteProviders(false);
    }

    void hydrate();
  }, [isPendingCopilotLoginExpired, refreshRemoteProviders]);

  const renderedSnapshots = useMemo(() => {
    return PROVIDER_ORDER.map((providerId) => {
      const snapshot = snapshots[providerId];
      if (snapshot) {
        return snapshot;
      }

      if (providerId === "codex") {
        return buildFallbackSnapshot("codex", "Run `codex login` then refresh. Import fallback is also available.");
      }

      if (providerId === "claude") {
        return buildFallbackSnapshot("claude", "Run `claude login` then refresh, or set Claude OAuth token.");
      }

      return buildFallbackSnapshot("copilot", "Start Copilot Device Login, then Complete Copilot Device Login.");
    });
  }, [snapshots]);

  const isBusy = isLoading || isRefreshing;
  const hasStoredCopilotToken = !!copilotTokenState?.trim();
  const pendingCopilotExpiresAt =
    pendingCopilotLogin && !isPendingCopilotLoginExpired(pendingCopilotLogin)
      ? new Date(Date.parse(pendingCopilotLogin.createdAt) + pendingCopilotLogin.expiresIn * 1000).toISOString()
      : undefined;

  return (
    <List isLoading={isBusy} searchBarPlaceholder="Search usage limits...">
      {renderedSnapshots.map((snapshot) => (
        <List.Section
          key={snapshot.provider}
          title={sectionTitle(snapshot)}
          subtitle={`Updated ${formatRelativeTimestamp(snapshot.fetchedAt)}`}
        >
          {snapshot.quotas.map((quota) => (
            <List.Item
              key={`${snapshot.provider}-${quota.id}`}
              icon={quotaProgressIcon(quota)}
              title={quota.label}
              subtitle={quota.remainingDisplay}
              accessories={quotaAccessories(quota)}
              actions={
                <ActionPanel>
                  <Action
                    title="Refresh All"
                    icon={Icon.ArrowClockwise}
                    onAction={() => void refreshRemoteProviders(true)}
                  />
                  <Action.Push
                    title="Import Codex Usage"
                    icon={Icon.Upload}
                    target={<CodexImportForm onImport={importCodexPayload} />}
                  />
                  {snapshot.provider === "copilot" && (
                    <Action
                      title="Start Copilot Device Login"
                      icon={Icon.Link}
                      onAction={() => void startCopilotDeviceFlow()}
                    />
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
                      onAction={() => void clearPendingCopilotLogin()}
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
                  <Action.OpenInBrowser
                    title={`Open ${PROVIDER_TITLES[snapshot.provider]} Usage Page`}
                    icon={Icon.Globe}
                    url={providerUrl(snapshot.provider, preferences)}
                  />
                  <Action.CopyToClipboard
                    title={`Copy ${PROVIDER_TITLES[snapshot.provider]} Raw Snapshot`}
                    icon={Icon.Clipboard}
                    content={JSON.stringify(snapshot, null, 2)}
                  />
                  <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                </ActionPanel>
              }
            />
          ))}
          {snapshot.errors?.map((error, index) => (
            <List.Item
              key={`${snapshot.provider}-error-${index}`}
              icon={statusIcon("critical")}
              title="Provider Warning"
              subtitle={error}
              actions={
                <ActionPanel>
                  <Action
                    title="Refresh All"
                    icon={Icon.ArrowClockwise}
                    onAction={() => void refreshRemoteProviders(true)}
                  />
                  <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      <List.Section
        title="Status"
        subtitle={lastRefreshAt ? `Last full refresh ${formatRelativeTimestamp(lastRefreshAt)}` : "No refresh yet"}
      >
        <List.Item
          icon={Icon.Clock}
          title="Dashboard"
          subtitle={isRefreshing ? "Refreshing provider data..." : "Ready"}
          actions={
            <ActionPanel>
              <Action
                title="Refresh All"
                icon={Icon.ArrowClockwise}
                onAction={() => void refreshRemoteProviders(true)}
              />
              <Action.Push
                title="Import Codex Usage"
                icon={Icon.Upload}
                target={<CodexImportForm onImport={importCodexPayload} />}
              />
              <Action
                title="Start Copilot Device Login"
                icon={Icon.Link}
                onAction={() => void startCopilotDeviceFlow()}
              />
              {pendingCopilotLogin && (
                <Action
                  title="Complete Copilot Device Login"
                  icon={Icon.CheckCircle}
                  onAction={() => void completeCopilotDeviceFlow()}
                />
              )}
              {pendingCopilotLogin && (
                <Action
                  title="Copy Copilot Device Code"
                  icon={Icon.Clipboard}
                  onAction={() => void Clipboard.copy(pendingCopilotLogin.userCode)}
                />
              )}
              {pendingCopilotLogin && (
                <Action.OpenInBrowser
                  title="Open GitHub Device Verification"
                  icon={Icon.Globe}
                  url={pendingCopilotLogin.verificationUri}
                />
              )}
              {pendingCopilotLogin && (
                <Action
                  title="Cancel Copilot Device Login"
                  icon={Icon.Trash}
                  onAction={() => void clearPendingCopilotLogin()}
                />
              )}
              <Action.Push
                title="Set Copilot Token"
                icon={Icon.Key}
                target={<CopilotTokenForm onSave={saveCopilotToken} />}
              />
              {hasStoredCopilotToken && (
                <Action
                  title="Clear Stored Copilot Token"
                  icon={Icon.XMarkCircle}
                  onAction={() => void clearStoredCopilotToken()}
                />
              )}
            </ActionPanel>
          }
        />
        {pendingCopilotLogin && (
          <List.Item
            icon={Icon.Key}
            title={`Copilot Device Code: ${pendingCopilotLogin.userCode}`}
            subtitle={
              pendingCopilotExpiresAt
                ? `Expires ${formatRelativeTimestamp(pendingCopilotExpiresAt)}. Paste this code on GitHub device page.`
                : "Code expired. Start Copilot Device Login again."
            }
            accessories={[{ text: pendingCopilotExpiresAt ? "Pending" : "Expired" }]}
            actions={
              <ActionPanel>
                <Action
                  title="Complete Copilot Device Login"
                  icon={Icon.CheckCircle}
                  onAction={() => void completeCopilotDeviceFlow()}
                />
                <Action
                  title="Copy Copilot Device Code"
                  icon={Icon.Clipboard}
                  onAction={() => void Clipboard.copy(pendingCopilotLogin.userCode)}
                />
                <Action.OpenInBrowser
                  title="Open GitHub Device Verification"
                  icon={Icon.Globe}
                  url={pendingCopilotLogin.verificationUri}
                />
                <Action
                  title="Cancel Copilot Device Login"
                  icon={Icon.Trash}
                  onAction={() => void clearPendingCopilotLogin()}
                />
              </ActionPanel>
            }
          />
        )}
      </List.Section>
    </List>
  );
}
