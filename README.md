# Agent Usage (Raycast)

Track Codex, Claude, and GitHub Copilot usage in one Raycast command with a design focused on remaining quota.

## Tracking sources

This extension uses these data paths:

1. Codex:
   - Auto: local Codex auth file + ChatGPT usage endpoint (`/backend-api/wham/usage`)
   - Fallback: manual import (`Import Codex Usage`)
2. Claude:
   - Auto: Claude OAuth usage endpoint (`https://api.anthropic.com/api/oauth/usage`) using local Claude credentials file
   - Optional override: manual Claude OAuth token in extension preferences
3. Copilot:
   - Auto: GitHub Copilot internal usage endpoint (`https://api.github.com/copilot_internal/user`)
   - Auth options:
     - Device flow from command actions (`Start Copilot Device Login` -> `Complete Copilot Device Login`)
     - Manual token in extension preferences or command form

## UI behavior

- Single dashboard command: `Agent Usage`
- Provider sections:
  - `Codex`
  - `GitHub Copilot`
  - `Claude`
- Rows show:
  - status dot
  - quota label
  - remaining text
  - reset/trend accessories when available

## Requirements

1. Raycast (Windows or macOS)
2. Node.js 20+
3. npm

Provider-specific:

1. Codex CLI logged in (`codex login`) for automatic Codex tracking
2. Claude CLI logged in (`claude login`) for automatic Claude tracking
3. GitHub account for Copilot device flow or a manual Copilot token

## Local development setup

1. Open terminal at this folder:
   - `D:\GitHub\agent-usage`
2. Install dependencies:
   - `npm install`
3. Validate:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
4. Run development mode:
   - `npm run dev`
5. Open Raycast command:
   - `Agent Usage`

## Extension preferences

Open extension preferences and set optional overrides:

1. `Codex Auth Token (Optional)`
   - If empty, extension reads `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`)
2. `Claude OAuth Access Token (Optional)`
   - If empty, extension reads Claude credentials file automatically
3. `Copilot API Token (Optional)`
   - If empty, use device login action or token form in command
4. Optional provider URLs:
   - `Codex Usage URL`
   - `Claude Usage URL`
   - `Copilot Usage URL`

## Copilot login options

### Option A: Device login (recommended)

1. Open `Agent Usage`
2. Run action: `Start Copilot Device Login`
3. Browser opens GitHub verification page
4. Paste the shown/copied device code and approve
5. Back in Raycast run: `Complete Copilot Device Login`
6. Token is saved to extension local storage

### Option B: Manual token

1. Run action: `Set Copilot Token`
2. Paste token and save

You can clear saved token with `Clear Stored Copilot Token`.

## Codex import fallback format

Use `Import Codex Usage` when API auto-fetch is unavailable.

JSON example:

```json
{
  "quotas": [
    {
      "label": "Weekly Limit",
      "remainingPercent": 68,
      "trendBadge": "+10%",
      "resetAt": "2026-02-25T00:00:00Z"
    },
    {
      "label": "5 Hour Limit",
      "remainingPercent": 100,
      "remainingDisplay": "4h left"
    }
  ]
}
```

Plain text example:

```text
Weekly Limit: 68% left +10% reset Feb 25
5 Hour Limit: 100% left 4h
```

## Command actions

- `Refresh All`
- `Import Codex Usage`
- `Start Copilot Device Login`
- `Complete Copilot Device Login`
- `Copy Copilot Device Code`
- `Set Copilot Token`
- `Clear Stored Copilot Token`
- `Open <Provider> Usage Page`
- `Copy <Provider> Raw Snapshot`
- `Open Extension Preferences`

## Troubleshooting

### Raycast shows "Something went wrong"

1. In this folder run:
   - `npm install`
   - `npm run lint`
   - `npm run typecheck`
2. Restart Raycast
3. Run `npm run dev` again
4. Open `Agent Usage`

### Codex is unavailable

1. Run `codex login`
2. Confirm auth file exists:
   - `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`)
3. Refresh dashboard
4. If still failing, use `Import Codex Usage` fallback

### Claude is unavailable

1. Run `claude login`
2. Confirm credentials file exists:
   - `~/.claude/.credentials.json` (or path from `CLAUDE_CONFIG_DIR`)
3. Refresh dashboard
4. If you still get `401/403`, set a fresh OAuth token in preferences

### Copilot is unavailable

1. Use `Start Copilot Device Login`, then `Complete Copilot Device Login`
2. If device flow fails, use `Set Copilot Token`
3. Refresh dashboard

## Known limitations

- Provider endpoints can change; parser updates may be needed.
- Some providers do not expose reset timestamps for all quota windows.
- This extension is designed for private/local use first.
