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
  "cursorUsageUrl": string
}
}

declare namespace Arguments {
  /** Arguments passed to the `agent-usage` command */
  export type AgentUsage = {}
}

