import { ProviderId, ProviderUsageSnapshot } from "../models/usage";

export interface ProviderDescriptor {
  id: ProviderId;
  title: string;
  defaultVisible: boolean;
  usageUrl: string;
  preferenceKeys?: string[];
  envKeys?: string[];
  cookieDomains?: string[];
  authHint: string;
  repairHint: string;
}

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "codex",
    title: "Codex",
    defaultVisible: true,
    usageUrl: "https://chatgpt.com/codex/settings/usage",
    preferenceKeys: ["codexAuthToken"],
    authHint: "Uses Codex CLI OAuth session or manual bearer token.",
    repairHint: "Run `codex login`, or set Codex Auth Token in preferences.",
  },
  {
    id: "cursor",
    title: "Cursor",
    defaultVisible: true,
    usageUrl: "https://cursor.com/dashboard",
    preferenceKeys: ["cursorCookieHeader"],
    envKeys: ["CURSOR_COOKIE_HEADER", "CURSOR_COOKIE"],
    cookieDomains: ["cursor.com", "cursor.sh"],
    authHint: "Uses Cursor web session cookies.",
    repairHint: "Set Cursor Cookie Source to Auto or provide a Cursor Cookie Header.",
  },
  {
    id: "copilot",
    title: "GitHub Copilot",
    defaultVisible: true,
    usageUrl: "https://github.com/settings/copilot",
    preferenceKeys: ["copilotApiToken"],
    envKeys: ["COPILOT_API_TOKEN", "GITHUB_TOKEN"],
    authHint: "Uses GitHub device flow or a Copilot API token.",
    repairHint: "Start Copilot Device Login, then Complete Copilot Device Login.",
  },
  {
    id: "claude",
    title: "Claude",
    defaultVisible: true,
    usageUrl: "https://claude.ai/settings/usage",
    preferenceKeys: ["claudeAccessToken"],
    authHint: "Uses Claude Code OAuth credentials or manual OAuth access token.",
    repairHint: "Run `claude login`, or set Claude OAuth Access Token in preferences.",
  },
  {
    id: "gemini",
    title: "Gemini",
    defaultVisible: true,
    usageUrl: "https://aistudio.google.com/app/plan",
    preferenceKeys: ["geminiAccessToken"],
    authHint: "Uses Gemini CLI OAuth credentials or manual OAuth access token.",
    repairHint: "Run `gemini` to authenticate, then refresh.",
  },
  {
    id: "antigravity",
    title: "Antigravity",
    defaultVisible: true,
    usageUrl: "https://antigravity.dev",
    preferenceKeys: ["antigravityServerUrl", "antigravityCsrfToken"],
    authHint: "Uses the local Antigravity language server.",
    repairHint: "Keep Antigravity running, or set Server URL and CSRF token.",
  },
  {
    id: "openai",
    title: "OpenAI API",
    defaultVisible: false,
    usageUrl: "https://platform.openai.com/usage",
    preferenceKeys: ["openaiAdminApiKey", "openaiApiKey"],
    envKeys: ["OPENAI_ADMIN_KEY", "OPENAI_API_KEY"],
    authHint: "Uses an OpenAI Admin API key, with legacy API-key balance fallback.",
    repairHint: "Set OpenAI Admin API Key or OpenAI API Key in preferences.",
  },
  {
    id: "claude-admin",
    title: "Claude Admin",
    defaultVisible: false,
    usageUrl: "https://console.anthropic.com/settings/usage",
    preferenceKeys: ["claudeAdminApiKey"],
    envKeys: ["ANTHROPIC_ADMIN_KEY", "CLAUDE_ADMIN_API_KEY"],
    authHint: "Uses an Anthropic Admin API key.",
    repairHint: "Set Claude Admin API Key in preferences.",
  },
  {
    id: "openrouter",
    title: "OpenRouter",
    defaultVisible: false,
    usageUrl: "https://openrouter.ai/settings/credits",
    preferenceKeys: ["openrouterApiKey"],
    envKeys: ["OPENROUTER_API_KEY"],
    authHint: "Uses an OpenRouter API key.",
    repairHint: "Set OpenRouter API Key in preferences.",
  },
  {
    id: "zai",
    title: "z.ai",
    defaultVisible: false,
    usageUrl: "https://z.ai/manage-apikey/subscription",
    preferenceKeys: ["zaiApiKey"],
    envKeys: ["Z_AI_API_KEY"],
    authHint: "Uses a z.ai API key.",
    repairHint: "Set z.ai API Key in preferences.",
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    defaultVisible: false,
    usageUrl: "https://platform.deepseek.com/usage",
    preferenceKeys: ["deepseekApiKey"],
    envKeys: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
    authHint: "Uses a DeepSeek API key.",
    repairHint: "Set DeepSeek API Key in preferences.",
  },
  {
    id: "moonshot",
    title: "Moonshot / Kimi API",
    defaultVisible: false,
    usageUrl: "https://platform.moonshot.ai/console/account",
    preferenceKeys: ["moonshotApiKey"],
    envKeys: ["MOONSHOT_API_KEY", "MOONSHOT_KEY"],
    authHint: "Uses a Moonshot/Kimi API key.",
    repairHint: "Set Moonshot API Key in preferences.",
  },
  {
    id: "mistral",
    title: "Mistral",
    defaultVisible: false,
    usageUrl: "https://admin.mistral.ai/billing",
    preferenceKeys: ["mistralCookieHeader"],
    envKeys: ["MISTRAL_COOKIE_HEADER", "MISTRAL_COOKIE"],
    cookieDomains: ["admin.mistral.ai"],
    authHint: "Uses Mistral console browser cookies.",
    repairHint: "Set Mistral Cookie Source to Auto or provide a Mistral Cookie Header.",
  },
  {
    id: "perplexity",
    title: "Perplexity",
    defaultVisible: false,
    usageUrl: "https://www.perplexity.ai/settings/api",
    preferenceKeys: ["perplexityCookieHeader", "perplexitySessionToken"],
    envKeys: ["PERPLEXITY_COOKIE", "PERPLEXITY_SESSION_TOKEN"],
    cookieDomains: ["perplexity.ai"],
    authHint: "Uses Perplexity browser session cookies or session token.",
    repairHint: "Set Perplexity Cookie/Header or Session Token in preferences.",
  },
  {
    id: "grok",
    title: "Grok",
    defaultVisible: false,
    usageUrl: "https://grok.com",
    preferenceKeys: ["grokCookieHeader"],
    envKeys: ["GROK_COOKIE_HEADER", "GROK_COOKIE"],
    cookieDomains: ["grok.com", "x.ai"],
    authHint: "Uses Grok CLI billing when available, or grok.com cookies.",
    repairHint: "Run `grok login` or provide a Grok Cookie Header.",
  },
  {
    id: "groqcloud",
    title: "GroqCloud",
    defaultVisible: false,
    usageUrl: "https://console.groq.com/settings/billing",
    preferenceKeys: ["groqcloudApiKey"],
    envKeys: ["GROQ_API_KEY", "GROQCLOUD_API_KEY"],
    authHint: "Uses a GroqCloud API key.",
    repairHint: "Set GroqCloud API Key in preferences.",
  },
  {
    id: "windsurf",
    title: "Windsurf",
    defaultVisible: false,
    usageUrl: "https://windsurf.com/account",
    preferenceKeys: ["windsurfCookieHeader"],
    envKeys: ["WINDSURF_COOKIE_HEADER", "WINDSURF_COOKIE"],
    cookieDomains: ["windsurf.com", "codeium.com"],
    authHint: "Uses Windsurf browser session data or local app cache when available.",
    repairHint: "Set Windsurf Cookie Source to Auto or provide a Windsurf Cookie Header.",
  },
  {
    id: "augment",
    title: "Augment",
    defaultVisible: false,
    usageUrl: "https://app.augmentcode.com/account",
    preferenceKeys: ["augmentApiKey", "augmentCookieHeader"],
    envKeys: ["AUGMENT_API_KEY", "AUGMENT_COOKIE_HEADER", "AUGMENT_COOKIE"],
    cookieDomains: ["augmentcode.com"],
    authHint: "Uses Augment CLI/API token or browser cookies.",
    repairHint: "Run `auggie login`, set Augment API Key, or provide Augment cookies.",
  },
  {
    id: "kiro",
    title: "Kiro",
    defaultVisible: false,
    usageUrl: "https://kiro.dev",
    preferenceKeys: ["kiroCliPath"],
    envKeys: ["KIRO_CLI_PATH"],
    authHint: "Uses the Kiro CLI usage command.",
    repairHint: "Install and sign in to Kiro CLI, or set Kiro CLI Path.",
  },
  {
    id: "warp",
    title: "Warp",
    defaultVisible: false,
    usageUrl: "https://app.warp.dev/account",
    preferenceKeys: ["warpApiKey"],
    envKeys: ["WARP_API_KEY", "WARP_TOKEN"],
    authHint: "Uses a Warp API token.",
    repairHint: "Set Warp API Key in preferences.",
  },
  {
    id: "zed",
    title: "Zed",
    defaultVisible: false,
    usageUrl: "https://dashboard.zed.dev/account",
    preferenceKeys: ["zedCookieHeader"],
    envKeys: ["ZED_COOKIE_HEADER", "ZED_COOKIE"],
    cookieDomains: ["dashboard.zed.dev", "zed.dev"],
    authHint: "Uses Zed dashboard browser cookies.",
    repairHint: "Set Zed Cookie Source to Auto or provide a Zed Cookie Header.",
  },
  {
    id: "kimi-k2",
    title: "Kimi K2",
    defaultVisible: false,
    usageUrl: "https://kimi-k2.ai",
    preferenceKeys: ["kimiK2ApiKey"],
    envKeys: ["KIMI_K2_API_KEY", "KIMI_API_KEY"],
    authHint: "Uses the legacy Kimi K2 API key flow.",
    repairHint: "Set Kimi K2 API Key in preferences.",
  },
  {
    id: "amp",
    title: "Amp",
    defaultVisible: false,
    usageUrl: "https://ampcode.com/settings",
    preferenceKeys: ["ampCookieHeader"],
    envKeys: ["AMP_COOKIE_HEADER", "AMP_COOKIE"],
    cookieDomains: ["ampcode.com"],
    authHint: "Uses Amp settings browser cookies.",
    repairHint: "Set Amp Cookie Source to Auto or provide Amp Cookie Header.",
  },
  {
    id: "minimax",
    title: "MiniMax",
    defaultVisible: false,
    usageUrl: "https://platform.minimax.io/user-center/payment/coding-plan",
    preferenceKeys: ["minimaxApiKey", "minimaxCookieHeader"],
    envKeys: ["MINIMAX_API_KEY", "MINIMAX_COOKIE_HEADER", "MINIMAX_COOKIE"],
    cookieDomains: ["platform.minimax.io", "minimax.io", "platform.minimaxi.com"],
    authHint: "Uses MiniMax coding-plan API key or browser cookies.",
    repairHint: "Set MiniMax API Key, or use Cookie Source Auto/manual.",
  },
  {
    id: "opencode",
    title: "OpenCode",
    defaultVisible: false,
    usageUrl: "https://opencode.ai",
    preferenceKeys: ["opencodeCookieHeader"],
    envKeys: ["OPENCODE_COOKIE_HEADER", "OPENCODE_COOKIE"],
    cookieDomains: ["opencode.ai"],
    authHint: "Uses OpenCode browser cookies.",
    repairHint: "Set OpenCode Cookie Source to Auto or provide OpenCode Cookie Header.",
  },
  {
    id: "opencode-go",
    title: "OpenCode Go",
    defaultVisible: false,
    usageUrl: "https://opencode.ai",
    preferenceKeys: ["opencodeCookieHeader", "opencodeWorkspaceId"],
    envKeys: ["OPENCODE_COOKIE_HEADER", "OPENCODE_COOKIE", "CODEXBAR_OPENCODEGO_WORKSPACE_ID"],
    cookieDomains: ["opencode.ai"],
    authHint: "Uses OpenCode workspace cookies for Go usage windows.",
    repairHint: "Set OpenCode Cookie Source to Auto/manual and optionally Workspace ID.",
  },
];

export const CORE_PROVIDERS: ProviderId[] = PROVIDER_DESCRIPTORS.filter((provider) => provider.defaultVisible).map(
  (provider) => provider.id,
);
export const OPTIONAL_PROVIDERS: ProviderId[] = PROVIDER_DESCRIPTORS.filter((provider) => !provider.defaultVisible).map(
  (provider) => provider.id,
);
export const PROVIDER_ORDER: ProviderId[] = PROVIDER_DESCRIPTORS.map((provider) => provider.id);
export const PROVIDER_TITLES: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_DESCRIPTORS.map((provider) => [provider.id, provider.title]),
) as Record<ProviderId, string>;

const DESCRIPTOR_MAP = new Map(PROVIDER_DESCRIPTORS.map((provider) => [provider.id, provider]));

export function providerDescriptor(provider: ProviderId): ProviderDescriptor {
  const descriptor = DESCRIPTOR_MAP.get(provider);
  if (!descriptor) {
    throw new Error(`Unknown provider ${provider}`);
  }
  return descriptor;
}

export function providerTitle(provider: ProviderId): string {
  return providerDescriptor(provider).title;
}

export function providerDefaultUrl(provider: ProviderId): string {
  return providerDescriptor(provider).usageUrl;
}

export function providerHasConfiguredCredential(
  provider: ProviderId,
  preferences: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const descriptor = providerDescriptor(provider);
  const hasPreference = (descriptor.preferenceKeys ?? []).some((key) => {
    const value = preferences[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (hasPreference) {
    return true;
  }

  return (descriptor.envKeys ?? []).some((key) => !!env[key]?.trim());
}

export function providerHasSuccessfulSnapshot(snapshot: ProviderUsageSnapshot | undefined): boolean {
  return !!snapshot && !snapshot.quotas.some((quota) => quota.label === "Unavailable");
}

export function providerShouldAutoShow(
  provider: ProviderId,
  preferences: Record<string, unknown>,
  snapshots: Partial<Record<ProviderId, ProviderUsageSnapshot>>,
): boolean {
  if (providerDescriptor(provider).defaultVisible) {
    return true;
  }

  return providerHasConfiguredCredential(provider, preferences) || providerHasSuccessfulSnapshot(snapshots[provider]);
}
