# Agent Usage (Raycast)

Track Codex, Claude, and GitHub Copilot usage limits and reset windows in one Raycast command.

## Features

- Unified dashboard with one-row provider summaries for Codex, Claude, and Copilot.
- Provider drilldown views with quota details, inline issues, and provider-scoped actions.
- Progress rings based on real remaining percentage.
- Copilot device login flow inside the command.
- Quick auth-repair actions from provider rows and detail views.

## Data sources

- Codex: ChatGPT usage endpoint (`/backend-api/wham/usage`) with your existing Codex login session.
- Claude: OAuth usage endpoint (`https://api.anthropic.com/api/oauth/usage`) with your existing Claude login session.
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
3. If Copilot is unavailable, use device login again or set a fresh token.

## Known limitations

- Provider endpoints can change.
- Some provider reset timestamps can be missing or approximate (Copilot uses first-of-month fallback when absent).
