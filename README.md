# Agent Usage (Raycast)

Track Codex, Claude, Cursor, Gemini, and GitHub Copilot usage limits and reset windows in one Raycast command.

## Features

- Unified dashboard with one-row provider summaries for Codex, Claude, Cursor, Gemini, and Copilot.
- Provider drilldown views with quota details, inline issues, provider-scoped actions, and richer provider metadata.
- Progress rings based on real remaining percentage.
- Copilot device login flow inside the command.
- Quick auth-repair actions from provider rows and detail views.
- Quota history trends per limit (sparkline + 24h/7d deltas).
- Staleness detection and freshness indicators for provider snapshots.
- Redacted debug snapshot copy action (tokens/cookies/secrets removed).
- Local usage-cost scanning for Codex and Claude CLI logs (best-effort summary).

## Data sources

- Codex: ChatGPT usage endpoint (`/backend-api/wham/usage`) with your existing Codex login session.
- Claude: OAuth usage endpoint (`https://api.anthropic.com/api/oauth/usage`) with your existing Claude login session.
  - Includes 5h/weekly windows, model-specific windows, OAuth-app weekly window, and extra-usage budget (when present).
- Cursor: web usage endpoints (`https://cursor.com/api/usage-summary`, `https://cursor.com/api/auth/me`) with your Cursor cookie header.
  - Includes included-plan budget, on-demand budget, team on-demand (if present), and legacy request limits (if present).
- Gemini: Cloud Code quota endpoints (`https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`) with Gemini CLI OAuth credentials.
  - Includes grouped model quotas (Pro/Flash), tier hints from `loadCodeAssist`, and project-aware quota lookup.
- Copilot: GitHub Copilot endpoint (`https://api.github.com/copilot_internal/user`) with device flow or token auth.
  - If reset timestamps are missing in the response, Copilot resets default to the next first-of-month boundary.

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
   - Set `Cursor Cookie Header` in extension preferences from an authenticated `cursor.com` request.
   - Accepted formats:
     - Full copied request headers (the extension extracts `Cookie:` automatically)
     - `Cookie: key=value; key2=value2`
     - Raw cookie string (`key=value; key2=value2`)
5. Gemini
   - Automatic: use existing Gemini CLI OAuth credentials from `~/.gemini/oauth_creds.json`
   - Optional: set `Gemini OAuth Access Token` in extension preferences
   - Run `gemini` in terminal if credentials are missing or expired

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
3. If Cursor is unavailable, update `Cursor Cookie Header` in preferences from a fresh `cursor.com` session.
4. If Gemini is unavailable, run `gemini` to refresh OAuth credentials, then refresh.
5. If Copilot is unavailable, use device login again or set a fresh token.

## Known limitations

- Provider endpoints can change.
- Some provider reset timestamps can be missing or approximate (Copilot uses first-of-month fallback when absent).
- Local cost scanning is best-effort and depends on locally available CLI log files.
