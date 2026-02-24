/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `agent-usage` command */
  export type AgentUsage = ExtensionPreferences & {
  /** Codex Auth Token (Optional) - Optional Bearer token override. Leave empty to auto-read ~/.codex/auth.json. */
  "codexAuthToken"?: string,
  /** Claude OAuth Access Token (Optional) - Optional OAuth token override. Leave empty to auto-read Claude credentials file. */
  "claudeAccessToken"?: string,
  /** Gemini OAuth Access Token (Optional) - Optional OAuth token override. Leave empty to auto-read ~/.gemini/oauth_creds.json. */
  "geminiAccessToken"?: string,
  /** Antigravity CSRF Token (Optional) - CSRF token required by local Antigravity language server endpoints. */
  "antigravityCsrfToken"?: string,
  /** Copilot API Token (Optional) - Optional manual token. You can also use device login from the command actions. */
  "copilotApiToken"?: string,
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
  /** OpenCode Workspace ID (Optional) - Optional wrk_... override for OpenCode usage fetch. */
  "opencodeWorkspaceId"?: string,
  /** OpenRouter Usage URL - Usage page opened by the OpenRouter action. */
  "openrouterUsageUrl": string,
  /** z.ai Usage URL - Usage page opened by the z.ai action. */
  "zaiUsageUrl": string,
  /** Kimi K2 Usage URL - Usage page opened by the Kimi K2 action. */
  "kimiK2UsageUrl": string,
  /** Amp Usage URL - Usage page opened by the Amp action. */
  "ampUsageUrl": string,
  /** MiniMax Usage URL - Usage page opened by the MiniMax action. */
  "minimaxUsageUrl": string,
  /** OpenCode Usage URL - Usage page opened by the OpenCode action. */
  "opencodeUsageUrl": string
}
}

declare namespace Arguments {
  /** Arguments passed to the `agent-usage` command */
  export type AgentUsage = {}
}

