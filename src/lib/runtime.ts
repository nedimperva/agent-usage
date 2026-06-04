import { LocalStorage } from "@raycast/api";
import { fetchProviderStatus, ProviderStatusSnapshot, statusEndpointForProvider } from "./status";
import { ProviderId, ProviderUsageSnapshot } from "../models/usage";
import { PendingCopilotDeviceLogin } from "../models/copilot";
import { PROVIDER_TITLES, providerDefaultUrl } from "./provider-registry";
import { fetchClaudeSnapshot } from "../providers/claude";
import { fetchClaudeAdminSnapshot } from "../providers/claude-admin";
import { fetchCodexSnapshot } from "../providers/codex";
import { fetchCopilotSnapshot } from "../providers/copilot";
import { fetchCursorSnapshot } from "../providers/cursor";
import { fetchGeminiSnapshot } from "../providers/gemini";
import { fetchAntigravitySnapshot } from "../providers/antigravity";
import { fetchOpenAISnapshot } from "../providers/openai";
import { fetchOpenRouterSnapshot } from "../providers/openrouter";
import { fetchZaiSnapshot } from "../providers/zai";
import { fetchDeepSeekSnapshot } from "../providers/deepseek";
import { fetchMoonshotSnapshot } from "../providers/moonshot";
import { fetchMistralSnapshot } from "../providers/mistral";
import { fetchPerplexitySnapshot } from "../providers/perplexity";
import { fetchGrokSnapshot } from "../providers/grok";
import { fetchGroqCloudSnapshot } from "../providers/groqcloud";
import { fetchWindsurfSnapshot } from "../providers/windsurf";
import { fetchAugmentSnapshot } from "../providers/augment";
import { fetchKiroSnapshot } from "../providers/kiro";
import { fetchWarpSnapshot } from "../providers/warp";
import { fetchZedSnapshot } from "../providers/zed";
import { fetchKimiK2Snapshot } from "../providers/kimi-k2";
import { fetchAmpSnapshot } from "../providers/amp";
import { fetchMiniMaxSnapshot } from "../providers/minimax";
import { fetchOpenCodeSnapshot } from "../providers/opencode";
import { fetchOpenCodeGoSnapshot } from "../providers/opencode-go";
export {
  parseLegacyOptionalProviders,
  parseMainScreenProviders,
  resolveStoredMainScreenProviders,
  sortMainScreenProviders,
} from "./main-screen-providers";

export const COPILOT_TOKEN_STORAGE_KEY = "agent-usage.copilot.device-token.v1";
export const COPILOT_DEVICE_PENDING_KEY = "agent-usage.copilot.device-pending.v1";
export const COPILOT_LAST_SUCCESS_KEY = "agent-usage.copilot.last-success-at.v1";
export const COPILOT_DEVICE_EVENTS_KEY = "agent-usage.copilot.device-events.v1";
export const MAIN_SCREEN_PROVIDERS_KEY = "agent-usage.main-screen-providers.v1";
export const LEGACY_OPTIONAL_PROVIDERS_KEY = "agent-usage.optional-providers.v1";
export const CURSOR_COOKIE_CACHE_KEY = "agent-usage.cursor.cookie-cache.v1";
export const AMP_COOKIE_CACHE_KEY = "agent-usage.amp.cookie-cache.v1";
export const OPENCODE_COOKIE_CACHE_KEY = "agent-usage.opencode.cookie-cache.v1";
export const MINIMAX_COOKIE_CACHE_KEY = "agent-usage.minimax.cookie-cache.v1";
export const ZED_COOKIE_CACHE_KEY = "agent-usage.zed.cookie-cache.v1";
export const MISTRAL_COOKIE_CACHE_KEY = "agent-usage.mistral.cookie-cache.v1";
export const PERPLEXITY_COOKIE_CACHE_KEY = "agent-usage.perplexity.cookie-cache.v1";
export const GROK_COOKIE_CACHE_KEY = "agent-usage.grok.cookie-cache.v1";
export const WINDSURF_COOKIE_CACHE_KEY = "agent-usage.windsurf.cookie-cache.v1";
export const AUGMENT_COOKIE_CACHE_KEY = "agent-usage.augment.cookie-cache.v1";

const PROVIDER_STATUS_CACHE_TTL_MS = 15 * 60 * 1000;

export interface Preferences {
  codexAuthToken?: string;
  openaiAdminApiKey?: string;
  openaiApiKey?: string;
  claudeAccessToken?: string;
  claudeAdminApiKey?: string;
  claudeAdminUsageUrl?: string;
  geminiAccessToken?: string;
  antigravityCsrfToken?: string;
  antigravityServerUrl?: string;
  checkProviderStatus?: boolean;
  copilotApiToken?: string;
  copilotEnterpriseUrl?: string;
  cursorCookieHeader?: string;
  cursorCookieSourceMode?: "auto" | "manual";
  openrouterApiKey?: string;
  openrouterApiBaseUrl?: string;
  zaiApiKey?: string;
  zaiQuotaUrl?: string;
  deepseekApiKey?: string;
  moonshotApiKey?: string;
  moonshotRegion?: "global" | "cn";
  moonshotBalanceUrl?: string;
  mistralCookieHeader?: string;
  mistralCookieSourceMode?: "auto" | "manual";
  mistralUsageApiUrl?: string;
  perplexityCookieHeader?: string;
  perplexitySessionToken?: string;
  perplexityCookieSourceMode?: "auto" | "manual";
  perplexityUsageApiUrl?: string;
  grokCookieHeader?: string;
  grokCookieSourceMode?: "auto" | "manual";
  grokUsageApiUrl?: string;
  groqcloudApiKey?: string;
  groqcloudUsageApiUrl?: string;
  windsurfCookieHeader?: string;
  windsurfCookieSourceMode?: "auto" | "manual";
  windsurfUsageApiUrl?: string;
  augmentApiKey?: string;
  augmentCookieHeader?: string;
  augmentCookieSourceMode?: "auto" | "manual";
  augmentUsageApiUrl?: string;
  kiroCliPath?: string;
  warpApiKey?: string;
  warpGraphqlUrl?: string;
  zedCookieHeader?: string;
  zedCookieSourceMode?: "auto" | "manual";
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
  openaiUsageUrl?: string;
  claudeUsageUrl?: string;
  claudeAdminConsoleUrl?: string;
  geminiUsageUrl?: string;
  antigravityUsageUrl?: string;
  copilotUsageUrl?: string;
  cursorUsageUrl?: string;
  openrouterUsageUrl?: string;
  zaiUsageUrl?: string;
  deepseekUsageUrl?: string;
  moonshotUsageUrl?: string;
  mistralUsageUrl?: string;
  perplexityUsageUrl?: string;
  grokUsageUrl?: string;
  groqcloudUsageUrl?: string;
  windsurfUsageUrl?: string;
  augmentUsageUrl?: string;
  kiroUsageUrl?: string;
  warpUsageUrl?: string;
  zedUsageUrl?: string;
  kimiK2UsageUrl?: string;
  ampUsageUrl?: string;
  minimaxUsageUrl?: string;
  opencodeUsageUrl?: string;
}

export interface ProviderFetchRuntime {
  copilotToken?: string;
  pendingCopilotLogin?: PendingCopilotDeviceLogin;
  copilotLastSuccessAt?: string;
  copilotDeviceEvents?: string[];
  providerStatusCache?: Partial<Record<ProviderId, ProviderStatusSnapshot>>;
}

export { PROVIDER_TITLES };

export function buildFallbackSnapshot(provider: ProviderId, reason: string): ProviderUsageSnapshot {
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
    source: "api",
  };
}

export function providerUrl(provider: ProviderId, preferences: Preferences): string {
  if (provider === "codex") {
    return preferences.codexUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "openai") {
    return preferences.openaiUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "claude") {
    return preferences.claudeUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "claude-admin") {
    return preferences.claudeAdminConsoleUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "gemini") {
    return preferences.geminiUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "antigravity") {
    return (
      preferences.antigravityUsageUrl?.trim() ||
      preferences.antigravityServerUrl?.trim() ||
      providerDefaultUrl(provider)
    );
  }
  if (provider === "cursor") {
    return preferences.cursorUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "openrouter") {
    return preferences.openrouterUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "zai") {
    return preferences.zaiUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "deepseek") {
    return preferences.deepseekUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "moonshot") {
    return preferences.moonshotUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "mistral") {
    return preferences.mistralUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "perplexity") {
    return preferences.perplexityUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "grok") {
    return preferences.grokUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "groqcloud") {
    return preferences.groqcloudUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "windsurf") {
    return preferences.windsurfUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "augment") {
    return preferences.augmentUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "kiro") {
    return preferences.kiroUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "warp") {
    return preferences.warpUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "zed") {
    return preferences.zedUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "kimi-k2") {
    return preferences.kimiK2UsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "amp") {
    return preferences.ampUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "minimax") {
    return preferences.minimaxUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "opencode") {
    return preferences.opencodeUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  if (provider === "opencode-go") {
    return preferences.opencodeUsageUrl?.trim() || providerDefaultUrl(provider);
  }
  return preferences.copilotUsageUrl?.trim() || providerDefaultUrl(provider);
}

export function isPendingCopilotLoginExpired(pending: PendingCopilotDeviceLogin | undefined): boolean {
  if (!pending) {
    return true;
  }

  const createdMs = Date.parse(pending.createdAt);
  if (Number.isNaN(createdMs)) {
    return true;
  }

  return Date.now() > createdMs + pending.expiresIn * 1000;
}

async function readTrimmedStorageValue(key: string): Promise<string | undefined> {
  return (await LocalStorage.getItem<string>(key))?.trim();
}

async function enrichSnapshotWithStatus(
  snapshot: ProviderUsageSnapshot,
  preferences: Preferences,
  providerStatusCache?: Partial<Record<ProviderId, ProviderStatusSnapshot>>,
): Promise<ProviderUsageSnapshot> {
  if (!preferences.checkProviderStatus) {
    return snapshot;
  }

  const endpoint = statusEndpointForProvider(snapshot.provider);
  if (!endpoint) {
    return snapshot;
  }

  const now = Date.now();
  const cached = providerStatusCache?.[snapshot.provider];
  const cachedAt = cached ? Date.parse(cached.checkedAt) : NaN;
  let statusSnapshot = cached;

  if (!cached || Number.isNaN(cachedAt) || now - cachedAt > PROVIDER_STATUS_CACHE_TTL_MS) {
    statusSnapshot = await fetchProviderStatus(snapshot.provider);
    if (statusSnapshot && providerStatusCache) {
      providerStatusCache[snapshot.provider] = statusSnapshot;
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

  const metadataSections = [
    ...(snapshot.metadataSections ?? []).filter((section) => section.id !== "service-status"),
    {
      id: "service-status",
      title: "Service Status",
      items: [
        { label: "Level", value: statusSnapshot.level },
        { label: "Summary", value: statusSnapshot.summary },
        { label: "Endpoint", value: endpoint },
        { label: "Checked", value: statusSnapshot.checkedAt },
      ],
    },
  ];

  return {
    ...snapshot,
    highlights: nextHighlights,
    metadataSections,
  };
}

export async function fetchProviderSnapshotWithPreferences(
  provider: ProviderId,
  preferences: Preferences,
  runtime: ProviderFetchRuntime = {},
): Promise<ProviderUsageSnapshot> {
  const withStatus = async (snapshot: ProviderUsageSnapshot): Promise<ProviderUsageSnapshot> =>
    enrichSnapshotWithStatus(snapshot, preferences, runtime.providerStatusCache);

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
    return withStatus(await fetchClaudeAdminSnapshot(preferences.claudeAdminApiKey, preferences.claudeAdminUsageUrl));
  }

  if (provider === "cursor") {
    return withStatus(
      await fetchCursorSnapshot({
        cookieHeader: preferences.cursorCookieHeader,
        cookieSourceMode: preferences.cursorCookieSourceMode,
        cachedCookieHeader: await readTrimmedStorageValue(CURSOR_COOKIE_CACHE_KEY),
        onCookieResolved: async (cookieHeader) => {
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
    return withStatus(await fetchOpenRouterSnapshot(preferences.openrouterApiKey, preferences.openrouterApiBaseUrl));
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
        cachedCookieHeader: await readTrimmedStorageValue(MISTRAL_COOKIE_CACHE_KEY),
        usageUrl: preferences.mistralUsageApiUrl,
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(PERPLEXITY_COOKIE_CACHE_KEY),
        usageUrl: preferences.perplexityUsageApiUrl,
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(GROK_COOKIE_CACHE_KEY),
        usageUrl: preferences.grokUsageApiUrl,
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(WINDSURF_COOKIE_CACHE_KEY),
        usageUrl: preferences.windsurfUsageApiUrl,
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(AUGMENT_COOKIE_CACHE_KEY),
        usageUrl: preferences.augmentUsageApiUrl,
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(ZED_COOKIE_CACHE_KEY),
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(AMP_COOKIE_CACHE_KEY),
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(MINIMAX_COOKIE_CACHE_KEY),
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(OPENCODE_COOKIE_CACHE_KEY),
        workspaceId: preferences.opencodeWorkspaceId,
        onCookieResolved: async (cookieHeader) => {
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
        cachedCookieHeader: await readTrimmedStorageValue(OPENCODE_COOKIE_CACHE_KEY),
        workspaceId: preferences.opencodeWorkspaceId,
        onCookieResolved: async (cookieHeader) => {
          await LocalStorage.setItem(OPENCODE_COOKIE_CACHE_KEY, cookieHeader);
        },
      }),
    );
  }

  const copilotToken =
    preferences.copilotApiToken?.trim() ||
    runtime.copilotToken?.trim() ||
    (await readTrimmedStorageValue(COPILOT_TOKEN_STORAGE_KEY));
  if (!copilotToken) {
    const pending = runtime.pendingCopilotLogin;
    if (pending && !isPendingCopilotLoginExpired(pending)) {
      throw new Error(
        `Device code ${pending.userCode} pending. Complete login, then run Complete Copilot Device Login.`,
      );
    }
    throw new Error("No Copilot token configured. Start Copilot Device Login.");
  }

  const tokenSource = preferences.copilotApiToken?.trim()
    ? "preference"
    : runtime.copilotToken?.trim()
      ? "local storage"
      : "local storage";
  return withStatus(
    await fetchCopilotSnapshot(copilotToken, {
      tokenSource,
      lastSuccessAt: runtime.copilotLastSuccessAt,
      recentDeviceEvents: runtime.copilotDeviceEvents?.slice(0, 3),
      githubEnterpriseBaseUrl: preferences.copilotEnterpriseUrl,
    }),
  );
}
