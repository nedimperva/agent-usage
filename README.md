# Agent Usage (Raycast)

Track Codex, Claude, Cursor, Gemini, Antigravity, GitHub Copilot, and optional API/cookie providers in one Raycast command.

## Features

- Unified dashboard with one-row provider summaries for Codex, Claude, Cursor, Gemini, Antigravity, and Copilot.
- Optional providers (`OpenRouter`, `z.ai`, `Kimi K2`, `Amp`, `MiniMax`, `OpenCode`) are hidden by default and only shown when enabled or configured.
- Cursor supports `Auto` cookie source mode with cached reuse and best-effort browser import.
- Amp/OpenCode/MiniMax support cookie `Auto` source mode with cached/env/browser fallback.
- Provider drilldown views with quota details, inline issues, provider-scoped actions, and richer provider metadata.
- Progress rings based on real remaining percentage.
- Copilot device login flow inside the command.
- Quick auth-repair actions from provider rows and detail views.
- Quota history trends per limit (sparkline + 24h/7d deltas).
- Staleness detection and freshness indicators for provider snapshots.
- Redacted debug snapshot copy action (tokens/cookies/secrets removed).
- Local usage-cost scanning for Codex and Claude CLI logs (best-effort summary).
- Optional provider status checks with incident highlights only when a service is degraded/outage.

## Data sources

- Codex: ChatGPT usage endpoint (`/backend-api/wham/usage`) with your existing Codex login session.
- Claude: OAuth usage endpoint (`https://api.anthropic.com/api/oauth/usage`) with your existing Claude login session.
  - Includes 5h/weekly windows, model-specific windows, OAuth-app weekly window, and extra-usage budget (when present).
- Cursor: web usage endpoints (`https://cursor.com/api/usage-summary`, `https://cursor.com/api/auth/me`) with your Cursor cookie header.
  - Includes included-plan budget, on-demand budget, team on-demand (if present), and legacy request limits (if present).
- Gemini: Cloud Code quota endpoints (`https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`) with Gemini CLI OAuth credentials.
  - Includes grouped model quotas (Pro/Flash), tier hints from `loadCodeAssist`, and project-aware quota lookup.
- Antigravity: local language-server endpoints (for example `/exa.language_server_pb.LanguageServerService/GetUserStatus`) using your local server URL and CSRF token.
  - Includes model quota tracking for Claude, Gemini Pro, and Gemini Flash when present.
- Copilot: GitHub Copilot endpoint (`https://api.github.com/copilot_internal/user`) with device flow or token auth.
  - If reset timestamps are missing in the response, Copilot resets default to the next first-of-month boundary.
- OpenRouter: credits + key quota endpoints (`/api/v1/credits`, `/api/v1/key`) with API key auth.
- z.ai: quota endpoint (`https://api.z.ai/api/monitor/usage/quota/limit`) with API key auth.
- Kimi K2: credit endpoint (`https://kimi-k2.ai/api/user/credits`) with API key auth.
- Amp: settings page (`https://ampcode.com/settings`) with cookie header auth.
- MiniMax: coding plan endpoints (`/v1/api/openplatform/coding_plan/remains`, `/v1/coding_plan/remains`) with API key auth, plus cookie-session fallback.
- OpenCode: server function endpoint (`https://opencode.ai/_server`) with cookie-session auth.

## Requirements

1. Raycast for Windows or macOS
2. Node.js 20+ and npm (development only)
3. Account access for the providers you want to track

## Development setup

1. Install dependencies: `npm install`
2. Validate: `npm run lint`
3. Validate types: `npm run typecheck`
4. Run tests: `npm test`
5. Start extension: `npm run dev`
6. Open command: `Agent Usage`

## Authentication options

1. Codex
   - Automatic: use your existing `codex login` session
   - Optional: set `Codex Auth Token` in extension preferences
2. Claude
   - Automatic: use your existing `claude login` session
   - Optional: set `Claude OAuth Access Token` in extension preferences
3. Copilot
   - Recommended: `Start Copilot Device Login` then `Complete Copilot Device Login`
   - Optional: set `Copilot API Token` in extension preferences
4. Cursor
   - Set `Cursor Cookie Source` to `Auto` (recommended) or `Manual`.
   - In `Auto`, the extension tries manual header, cached cookie, browser import (Chrome/Edge/Brave + Cursor desktop profile), env var, and Cursor desktop auth token fallback.
   - In `Manual`, set `Cursor Cookie Header` from an authenticated `cursor.com` request.
   - Accepted formats:
     - Full copied request headers (the extension extracts `Cookie:` automatically)
     - `Cookie: key=value; key2=value2`
     - Raw cookie string (`key=value; key2=value2`)
5. Gemini
   - Automatic: use existing Gemini CLI OAuth credentials from `~/.gemini/oauth_creds.json`
   - Optional: set `Gemini OAuth Access Token` in extension preferences
   - Run `gemini` in terminal if credentials are missing or expired
6. Antigravity
   - Auto: keep Antigravity running; extension auto-detects local server URL + CSRF token
   - Optional override: set `Antigravity Server URL` and `Antigravity CSRF Token` in extension preferences
   - Uses local Antigravity language-server quota endpoints
7. OpenRouter
   - Set `OpenRouter API Key` in extension preferences (or `OPENROUTER_API_KEY` env var)
   - Optional client headers via env: `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE`
8. z.ai
   - Set `z.ai API Key` in extension preferences (or `Z_AI_API_KEY` env var)
9. Kimi K2
   - Set `Kimi K2 API Key` in extension preferences (or `KIMI_K2_API_KEY` / `KIMI_API_KEY` env var)
10. Amp
   - Set `Amp Cookie Source` to `Auto` (recommended) or `Manual`
   - In `Auto`, extension tries manual header, cached cookie, env var, and browser import
   - In `Manual`, set `Amp Cookie Header` from an authenticated `ampcode.com/settings` request
11. MiniMax
   - Preferred: set `MiniMax API Key` in extension preferences (or `MINIMAX_API_KEY` env var)
   - Optional: set `MiniMax Cookie Source` to `Auto`/`Manual` and provide `MiniMax Cookie Header` for web-session fallback
12. OpenCode
   - Set `OpenCode Cookie Source` to `Auto` (recommended) or `Manual`
   - In `Auto`, extension tries manual header, cached cookie, env var, and browser import
   - In `Manual`, set `OpenCode Cookie Header` from an authenticated `opencode.ai` session

## Optional provider visibility

1. Core providers always show: Codex, Cursor, Copilot, Claude, Gemini, Antigravity.
2. Optional providers stay hidden unless:
   - you enable them via `Manage Optional Providers`, or
   - credentials are configured, or
   - a successful snapshot already exists.

## Provider status checks

1. Enable `Enable Provider Status Checks` in preferences to check provider status pages during refresh.
2. Dashboard rows stay clean: status text appears only when a provider reports degraded/outage state.

## Store publishing checklist

1. Run checks: `npm run lint && npm run typecheck && npm test && npm run build`
2. Capture screenshots: `npx @raycast/api@latest capture`
3. Publish: `npm run publish`

Raycast stores captured screenshots and store metadata in a top-level `metadata/` folder.

## Troubleshooting

1. If the command shows "Something went wrong", run:
   - `npm install`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run dev`
2. If Codex or Claude is unavailable, refresh login with `codex login` or `claude login`, then refresh the dashboard.
3. If Cursor is unavailable, switch Cursor Cookie Source to `Auto` or update `Cursor Cookie Header` manually.
   - If error mentions locked Cursor cookie databases, fully quit Cursor once and refresh so Auto can import a session.
4. If Gemini is unavailable, run `gemini` to refresh OAuth credentials, then refresh.
5. If Antigravity is unavailable, keep Antigravity running for auto-detect, or set server URL + CSRF token in preferences, then refresh.
6. If Copilot is unavailable, use device login again or set a fresh token.
7. If optional providers are missing from dashboard, open `Manage Optional Providers` and enable them.
8. For Amp/OpenCode/MiniMax cookie mode on Chrome, app-bound (`v20`) cookies may require manual Cookie header paste.

## Known limitations

- Provider endpoints can change.
- Some provider reset timestamps can be missing or approximate (Copilot uses first-of-month fallback when absent).
- Local cost scanning is best-effort and depends on locally available CLI log files.
