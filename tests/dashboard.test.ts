import { describe, expect, it } from "vitest";
import {
  refreshAllProviders,
  refreshSingleProvider,
  summarizeProviderSnapshot,
  SnapshotMap,
} from "../src/lib/dashboard";
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

describe("summarizeProviderSnapshot", () => {
  it("summarizes unavailable manual snapshots as warning", () => {
    const summary = summarizeProviderSnapshot(
      snapshot("copilot", {
        source: "manual",
        quotas: [
          {
            id: "copilot-placeholder",
            label: "Unavailable",
            remainingDisplay: "No Copilot token configured.",
            status: "unknown",
          },
        ],
      }),
      new Date("2026-02-23T12:00:00Z"),
    );

    expect(summary.status).toBe("warning");
    expect(summary.subtitle).toContain("No Copilot token configured.");
  });

  it("summarizes critical and warning quotas", () => {
    const summary = summarizeProviderSnapshot(
      snapshot("codex", {
        planLabel: "Pro",
        quotas: [
          {
            id: "weekly",
            label: "Weekly Limit",
            remainingPercent: 8,
            remainingDisplay: "8% left",
            status: "critical",
          },
          {
            id: "five-hour",
            label: "5 Hour Limit",
            remainingPercent: 20,
            remainingDisplay: "20% left",
            status: "warning",
          },
        ],
      }),
      new Date("2026-02-23T12:00:00Z"),
    );

    expect(summary.status).toBe("critical");
    expect(summary.title).toBe("Codex (Pro)");
    expect(summary.subtitle).toContain("Weekly Limit: 8%");
    expect(summary.subtitle).toContain("5 Hour Limit: 20%");
    expect(summary.subtitle).not.toContain("critical");
    expect(summary.subtitle).not.toContain("warning");
  });

  it("summarizes first two limits and extra count for healthy snapshots", () => {
    const summary = summarizeProviderSnapshot(
      snapshot("claude", {
        quotas: [
          { id: "five", label: "5 Hour Limit", remainingPercent: 100, remainingDisplay: "100% left", status: "ok" },
          { id: "week", label: "Weekly Limit", remainingPercent: 76, remainingDisplay: "76% left", status: "ok" },
          {
            id: "extra",
            label: "Extra Usage Budget",
            remainingDisplay: "USD 12.00 left",
            status: "unknown",
          },
        ],
      }),
      new Date("2026-02-23T12:00:00Z"),
    );

    expect(summary.subtitle).toContain("5 Hour Limit: 100%");
    expect(summary.subtitle).toContain("Weekly Limit: 76%");
    expect(summary.subtitle).toContain("+1 more");
  });

  it("keeps cursor quota summary before highlight details", () => {
    const summary = summarizeProviderSnapshot(
      snapshot("cursor", {
        highlights: ["Auto: 62%", "Named: 38%"],
        quotas: [{ id: "plan", label: "Included", remainingPercent: 60, remainingDisplay: "60% left", status: "ok" }],
      }),
      new Date("2026-02-23T12:00:00Z"),
    );

    const usageIndex = summary.subtitle.indexOf("Included: 60%");
    const autoIndex = summary.subtitle.indexOf("Auto: 62%");
    const namedIndex = summary.subtitle.indexOf("Named: 38%");
    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(autoIndex).toBeGreaterThanOrEqual(0);
    expect(namedIndex).toBeGreaterThanOrEqual(0);
    expect(usageIndex).toBeLessThan(autoIndex);
    expect(autoIndex).toBeLessThan(namedIndex);
  });

  it("keeps gemini quota summary before tier highlights", () => {
    const summary = summarizeProviderSnapshot(
      snapshot("gemini", {
        highlights: ["Tier: free-tier"],
        quotas: [{ id: "gemini-pro", label: "Pro Models", remainingPercent: 48, remainingDisplay: "48% left", status: "ok" }],
      }),
      new Date("2026-02-23T12:00:00Z"),
    );

    const proIndex = summary.subtitle.indexOf("Pro Models: 48%");
    const tierIndex = summary.subtitle.indexOf("Tier: free-tier");
    expect(proIndex).toBeGreaterThanOrEqual(0);
    expect(tierIndex).toBeGreaterThanOrEqual(0);
    expect(proIndex).toBeLessThan(tierIndex);
    expect(summary.subtitle).not.toContain("Project:");
  });
});

describe("refresh orchestration", () => {
  it("refreshSingleProvider updates only the targeted provider snapshot", async () => {
    const current: SnapshotMap = {
      codex: snapshot("codex", {
        quotas: [{ id: "old", label: "Old", remainingDisplay: "old", status: "ok" }],
      }),
      claude: snapshot("claude", {
        quotas: [{ id: "claude-old", label: "Old", remainingDisplay: "old", status: "ok" }],
      }),
    };

    const refreshedCodex = snapshot("codex", {
      quotas: [{ id: "new", label: "New", remainingDisplay: "new", status: "ok" }],
    });

    const result = await refreshSingleProvider(
      current,
      "codex",
      async (provider) => {
        expect(provider).toBe("codex");
        return refreshedCodex;
      },
      () => {
        throw new Error("fallback should not be used");
      },
      new Date("2026-02-23T14:00:00Z"),
    );

    expect(result.failed).toBe(false);
    expect(result.snapshot.quotas[0].id).toBe("new");
    expect(result.snapshots.codex?.quotas[0].id).toBe("new");
    expect(result.snapshots.claude?.quotas[0].id).toBe("claude-old");
    expect(result.refreshedAt).toBe("2026-02-23T14:00:00.000Z");
  });

  it("refreshAllProviders isolates failures and returns fallback snapshots", async () => {
    const result = await refreshAllProviders(
      {},
      async (provider) => {
        if (provider === "copilot") {
          throw new Error("bad token");
        }

        return snapshot(provider, {
          quotas: [{ id: `${provider}-ok`, label: "OK", remainingDisplay: "ok", status: "ok" }],
        });
      },
      (provider, error) =>
        snapshot(provider, {
          source: "manual",
          quotas: [
            {
              id: `${provider}-fallback`,
              label: "Unavailable",
              remainingDisplay: error instanceof Error ? error.message : "unknown",
              status: "unknown",
            },
          ],
        }),
      new Date("2026-02-23T14:30:00Z"),
    );

    expect(result.failedProviders).toEqual(["copilot"]);
    expect(result.snapshots.codex?.quotas[0].id).toBe("codex-ok");
    expect(result.snapshots.claude?.quotas[0].id).toBe("claude-ok");
    expect(result.snapshots.copilot?.source).toBe("manual");
    expect(result.snapshots.copilot?.quotas[0].remainingDisplay).toBe("bad token");
    expect(result.refreshedAt).toBe("2026-02-23T14:30:00.000Z");
  });
});
