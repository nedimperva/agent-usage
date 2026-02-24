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
  /** Copilot API Token (Optional) - Optional manual token. You can also use device login from the command actions. */
  "copilotApiToken"?: string,
  /** Cursor Cookie Header (Optional) - Optional cookie header for Cursor web API (from an active cursor.com session). */
  "cursorCookieHeader"?: string,
  /** Codex Usage URL - Usage page opened by the Codex action. */
  "codexUsageUrl": string,
  /** Claude Usage URL - Usage page opened by the Claude action. */
  "claudeUsageUrl": string,
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

