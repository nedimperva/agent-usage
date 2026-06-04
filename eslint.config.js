const { defineConfig } = require("eslint/config");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([
  {
    ignores: [
      "src/accounts/**",
      "src/agents/**",
      "src/amp/**",
      "src/antigravity/**",
      "src/claude/**",
      "src/codex/**",
      "src/copilot/**",
      "src/droid/**",
      "src/gemini/**",
      "src/kimi/**",
      "src/minimax/**",
      "src/opencode-go/**",
      "src/synthetic/**",
      "src/zai/**",
      "src/agent-usage-menubar.tsx",
    ],
  },
  ...raycastConfig,
]);
