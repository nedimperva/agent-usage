/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Codex Auth Token (Optional) - Optional Bearer token override. Leave empty to auto-read ~/.codex/auth.json. */
  "codexAuthToken"?: string,
  /** OpenAI Admin API Key (Optional) - Admin key for OpenAI organization spend and usage endpoints. */
  "openaiAdminApiKey"?: string,
  /** OpenAI API Key (Optional) - Fallback OpenAI API key for legacy balance checks when Admin usage is unavailable. */
  "openaiApiKey"?: string,
  /** Claude OAuth Access Token (Optional) - Optional OAuth token override. Leave empty to auto-read Claude credentials file. */
  "claudeAccessToken"?: string,
  /** Claude Admin API Key (Optional) - Admin key for Anthropic organization usage reports. */
  "claudeAdminApiKey"?: string,
  /** Gemini OAuth Access Token (Optional) - Optional OAuth token override. Leave empty to auto-read ~/.gemini/oauth_creds.json. */
  "geminiAccessToken"?: string,
  /** Antigravity CSRF Token (Optional) - CSRF token required by local Antigravity language server endpoints. */
  "antigravityCsrfToken"?: string,
  /** Copilot API Token (Optional) - Optional manual token. You can also use device login from the command actions. */
  "copilotApiToken"?: string,
  /** Copilot Enterprise URL (Optional) - GitHub Enterprise base URL for Copilot device flow and usage API (for example https://github.example.com). */
  "copilotEnterpriseUrl"?: string,
  /** Cursor Cookie Header (Optional) - Optional cookie header for Cursor web API (from an active cursor.com session). */
  "cursorCookieHeader"?: string,
  /** Cursor Cookie Source - Auto tries cached/environment/browser cookies; Manual uses only Cursor Cookie Header. */
  "cursorCookieSourceMode": "auto" | "manual",
  /** undefined - Show status highlights when providers report degraded/outage state. */
  "checkProviderStatus": boolean,
  /** OpenRouter API Key (Optional) - OpenRouter API key for credits and key quota endpoints. */
  "openrouterApiKey"?: string,
  /** z.ai API Key (Optional) - z.ai API key for usage quota endpoint. */
  "zaiApiKey"?: string,
  /** DeepSeek API Key (Optional) - DeepSeek API key for balance endpoint. */
  "deepseekApiKey"?: string,
  /** Moonshot API Key (Optional) - Moonshot/Kimi API key for account balance endpoint. */
  "moonshotApiKey"?: string,
  /** Moonshot Region - Moonshot/Kimi API region for balance checks. */
  "moonshotRegion": "global" | "cn",
  /** Mistral Cookie Header (Optional) - Cookie header from an authenticated admin.mistral.ai billing session. */
  "mistralCookieHeader"?: string,
  /** Mistral Cookie Source - Auto tries manual/cached/env/browser cookies; Manual uses only Mistral Cookie Header. */
  "mistralCookieSourceMode": "auto" | "manual",
  /** Perplexity Cookie Header (Optional) - Cookie header from an authenticated perplexity.ai session. */
  "perplexityCookieHeader"?: string,
  /** Perplexity Session Token (Optional) - Perplexity session token fallback when a full Cookie header is not provided. */
  "perplexitySessionToken"?: string,
  /** Perplexity Cookie Source - Auto tries manual/cached/env/browser cookies; Manual uses only configured Perplexity auth. */
  "perplexityCookieSourceMode": "auto" | "manual",
  /** Grok Cookie Header (Optional) - Cookie header from an authenticated grok.com session. */
  "grokCookieHeader"?: string,
  /** Grok Cookie Source - Auto tries CLI/local/manual/cached/env/browser sources; Manual uses only configured Grok cookies. */
  "grokCookieSourceMode": "auto" | "manual",
  /** GroqCloud API Key (Optional) - GroqCloud API key for usage metrics or API access validation. */
  "groqcloudApiKey"?: string,
  /** Windsurf Cookie Header (Optional) - Cookie header from an authenticated Windsurf/Codeium account session. */
  "windsurfCookieHeader"?: string,
  /** Windsurf Cookie Source - Auto tries local cache/manual/cached/env/browser cookies; Manual uses only Windsurf Cookie Header. */
  "windsurfCookieSourceMode": "auto" | "manual",
  /** Augment API Key (Optional) - Augment API key fallback when CLI or cookies are unavailable. */
  "augmentApiKey"?: string,
  /** Augment Cookie Header (Optional) - Cookie header from an authenticated Augment account session. */
  "augmentCookieHeader"?: string,
  /** Augment Cookie Source - Auto tries CLI/API/manual/cached/env/browser cookies; Manual uses only configured Augment cookies. */
  "augmentCookieSourceMode": "auto" | "manual",
  /** Kiro CLI Path (Optional) - Defaults to kiro-cli on PATH. */
  "kiroCliPath"?: string,
  /** Warp API Key (Optional) - Warp API token for GraphQL usage checks. */
  "warpApiKey"?: string,
  /** Zed Cookie Header (Optional) - Cookie header from an authenticated dashboard.zed.dev/account session. */
  "zedCookieHeader"?: string,
  /** Zed Cookie Source - Auto tries manual/cached/env/browser cookies; Manual uses only Zed Cookie Header. */
  "zedCookieSourceMode": "auto" | "manual",
  /** Kimi K2 API Key (Optional) - Kimi K2 API key for credit usage endpoint. */
  "kimiK2ApiKey"?: string,
  /** Amp Cookie Header (Optional) - Cookie header from an authenticated ampcode.com/settings request. */
  "ampCookieHeader"?: string,
  /** Amp Cookie Source - Auto tries manual/cached/env/browser cookies; Manual uses only Amp Cookie Header. */
  "ampCookieSourceMode": "auto" | "manual",
  /** MiniMax API Key (Optional) - MiniMax API key for coding plan remains endpoint. */
  "minimaxApiKey"?: string,
  /** MiniMax Cookie Header (Optional) - Cookie header or cURL from an authenticated platform.minimax.io session. */
  "minimaxCookieHeader"?: string,
  /** MiniMax Cookie Source - Auto tries manual/cached/env/browser cookies when API key is unavailable. */
  "minimaxCookieSourceMode": "auto" | "manual",
  /** OpenCode Cookie Header (Optional) - Cookie header from an authenticated opencode.ai session. */
  "opencodeCookieHeader"?: string,
  /** OpenCode Cookie Source - Auto tries manual/cached/env/browser cookies; Manual uses only OpenCode Cookie Header. */
  "opencodeCookieSourceMode": "auto" | "manual",
  /** Codex Usage URL - Usage page opened by the Codex action. */
  "codexUsageUrl": string,
  /** Claude Usage URL - Usage page opened by the Claude action. */
  "claudeUsageUrl": string,
  /** Gemini Usage URL - Usage page opened by the Gemini action. */
  "geminiUsageUrl": string,
  /** Antigravity Server URL (Optional) - Local Antigravity language server base URL (for example http://127.0.0.1:8080). */
  "antigravityServerUrl"?: string,
  /** Antigravity Usage URL - Usage page opened by the Antigravity action. */
  "antigravityUsageUrl": string,
  /** Copilot Usage URL - Usage page opened by the Copilot action. */
  "copilotUsageUrl": string,
  /** Cursor Usage URL - Usage page opened by the Cursor action. */
  "cursorUsageUrl": string,
  /** OpenRouter API Base URL (Optional) - Default is https://openrouter.ai/api/v1. */
  "openrouterApiBaseUrl"?: string,
  /** z.ai Quota URL (Optional) - Default is https://api.z.ai/api/monitor/usage/quota/limit. */
  "zaiQuotaUrl"?: string,
  /** Claude Admin Usage URL (Optional) - Override for Anthropic Admin usage-report endpoint. */
  "claudeAdminUsageUrl"?: string,
  /** Moonshot Balance URL (Optional) - Override for Moonshot/Kimi API balance endpoint. */
  "moonshotBalanceUrl"?: string,
  /** Mistral Usage API URL (Optional) - Override for Mistral console billing JSON endpoint. */
  "mistralUsageApiUrl"?: string,
  /** Perplexity Usage API URL (Optional) - Override for Perplexity credits/usage JSON endpoint. */
  "perplexityUsageApiUrl"?: string,
  /** Grok Usage API URL (Optional) - Override for Grok dashboard billing JSON endpoint. */
  "grokUsageApiUrl"?: string,
  /** GroqCloud Usage API URL (Optional) - Optional enterprise usage/metrics endpoint; otherwise the key is validated with the models API. */
  "groqcloudUsageApiUrl"?: string,
  /** Windsurf Usage API URL (Optional) - Override for Windsurf/Codeium usage JSON endpoint. */
  "windsurfUsageApiUrl"?: string,
  /** Augment Usage API URL (Optional) - Override for Augment account usage JSON endpoint. */
  "augmentUsageApiUrl"?: string,
  /** Warp GraphQL URL (Optional) - Default is https://app.warp.dev/graphql. */
  "warpGraphqlUrl"?: string,
  /** OpenCode Workspace ID (Optional) - Optional wrk_... override for OpenCode usage fetch. */
  "opencodeWorkspaceId"?: string,
  /** OpenRouter Usage URL - Usage page opened by the OpenRouter action. */
  "openrouterUsageUrl": string,
  /** z.ai Usage URL - Usage page opened by the z.ai action. */
  "zaiUsageUrl": string,
  /** OpenAI Usage URL - Usage page opened by the OpenAI API action. */
  "openaiUsageUrl": string,
  /** Claude Admin Console URL - Usage page opened by the Claude Admin action. */
  "claudeAdminConsoleUrl": string,
  /** DeepSeek Usage URL - Usage page opened by the DeepSeek action. */
  "deepseekUsageUrl": string,
  /** Moonshot Usage URL - Usage page opened by the Moonshot/Kimi API action. */
  "moonshotUsageUrl": string,
  /** Mistral Usage URL - Usage page opened by the Mistral action. */
  "mistralUsageUrl": string,
  /** Perplexity Usage URL - Usage page opened by the Perplexity action. */
  "perplexityUsageUrl": string,
  /** Grok Usage URL - Usage page opened by the Grok action. */
  "grokUsageUrl": string,
  /** GroqCloud Usage URL - Usage page opened by the GroqCloud action. */
  "groqcloudUsageUrl": string,
  /** Windsurf Usage URL - Usage page opened by the Windsurf action. */
  "windsurfUsageUrl": string,
  /** Augment Usage URL - Usage page opened by the Augment action. */
  "augmentUsageUrl": string,
  /** Kiro Usage URL - Usage page opened by the Kiro action. */
  "kiroUsageUrl": string,
  /** Warp Usage URL - Usage page opened by the Warp action. */
  "warpUsageUrl": string,
  /** Zed Usage URL - Usage page opened by the Zed action. */
  "zedUsageUrl": string,
  /** Kimi K2 Usage URL - Usage page opened by the Kimi K2 action. */
  "kimiK2UsageUrl": string,
  /** Amp Usage URL - Usage page opened by the Amp action. */
  "ampUsageUrl": string,
  /** MiniMax Usage URL - Usage page opened by the MiniMax action. */
  "minimaxUsageUrl": string,
  /** OpenCode Usage URL - Usage page opened by the OpenCode action. */
  "opencodeUsageUrl": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `agent-usage` command */
  export type AgentUsage = ExtensionPreferences & {}
  /** Preferences accessible in the `agent-usage-sampler` command */
  export type AgentUsageSampler = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `agent-usage` command */
  export type AgentUsage = {}
  /** Arguments passed to the `agent-usage-sampler` command */
  export type AgentUsageSampler = {}
}

