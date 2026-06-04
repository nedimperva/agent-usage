import { describe, expect, it } from "vitest";
import { SnapshotMap } from "../src/lib/dashboard";
import {
  MainScreenProviderPreferences,
  resolveStoredMainScreenProviders,
  sortMainScreenProviders,
} from "../src/lib/main-screen-providers";
import { ProviderUsageSnapshot } from "../src/models/usage";

function snapshot(
  provider: ProviderUsageSnapshot["provider"],
  overrides: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    provider,
    fetchedAt: "2026-02-23T12:00:00Z",
    quotas: [],
    source: "api",
    ...overrides,
  };
}

describe("resolveStoredMainScreenProviders", () => {
  it("migrates from legacy visibility and preserves the old visible provider set", () => {
    const snapshots: SnapshotMap = {
      amp: snapshot("amp", {
        quotas: [{ id: "amp-ok", label: "Amp", remainingDisplay: "ok", status: "ok" }],
      }),
    };

    const result = resolveStoredMainScreenProviders(
      undefined,
      JSON.stringify(["openrouter"]),
      {} as MainScreenProviderPreferences,
      snapshots,
    );

    expect(result.migrated).toBe(true);
    expect(result.providers).toEqual([
      "codex",
      "cursor",
      "copilot",
      "claude",
      "gemini",
      "antigravity",
      "openrouter",
      "amp",
    ]);
  });

  it("uses the explicit stored selection without auto-adding configured providers", () => {
    const preferences: MainScreenProviderPreferences = {
      openrouterApiKey: "test-key",
    };
    const snapshots: SnapshotMap = {
      openrouter: snapshot("openrouter", {
        quotas: [{ id: "openrouter-ok", label: "Credits", remainingDisplay: "ok", status: "ok" }],
      }),
    };

    const result = resolveStoredMainScreenProviders(
      JSON.stringify(["codex"]),
      JSON.stringify(["openrouter"]),
      preferences,
      snapshots,
    );

    expect(result.migrated).toBe(false);
    expect(result.providers).toEqual(["codex"]);
  });

  it("includes zed during legacy migration when a cookie header is configured", () => {
    const preferences: MainScreenProviderPreferences = {
      zedCookieHeader: "session=abc",
    };

    const result = resolveStoredMainScreenProviders(undefined, undefined, preferences, {});

    expect(result.migrated).toBe(true);
    expect(result.providers).toEqual(["codex", "cursor", "copilot", "claude", "gemini", "antigravity", "zed"]);
  });
});

describe("sortMainScreenProviders", () => {
  it("sorts by severity first and falls back to default provider order", () => {
    const snapshots: SnapshotMap = {
      cursor: snapshot("cursor", {
        quotas: [
          { id: "cursor", label: "Cursor", remainingDisplay: "4% left", remainingPercent: 4, status: "critical" },
        ],
      }),
      codex: snapshot("codex", {
        quotas: [
          { id: "codex", label: "Codex", remainingDisplay: "20% left", remainingPercent: 20, status: "warning" },
        ],
      }),
      zai: snapshot("zai", {
        quotas: [{ id: "zai", label: "z.ai", remainingDisplay: "25% left", remainingPercent: 25, status: "warning" }],
      }),
    };

    const sorted = sortMainScreenProviders(["zai", "codex", "cursor"], snapshots, new Date("2026-02-23T12:00:00Z"));

    expect(sorted).toEqual(["cursor", "codex", "zai"]);
  });
});
