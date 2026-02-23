import { describe, expect, it } from "vitest";
import { deriveSnapshotAlerts, summarizeAlerts } from "../src/lib/alerts";
import { ProviderUsageSnapshot } from "../src/models/usage";

function makeSnapshot(snapshot: Partial<ProviderUsageSnapshot> & Pick<ProviderUsageSnapshot, "provider">): ProviderUsageSnapshot {
  return {
    provider: snapshot.provider,
    fetchedAt: snapshot.fetchedAt ?? "2026-02-23T00:00:00Z",
    quotas: snapshot.quotas ?? [],
    source: snapshot.source ?? "api",
    planLabel: snapshot.planLabel,
    errors: snapshot.errors,
  };
}

describe("deriveSnapshotAlerts", () => {
  it("creates warning and critical alerts by threshold", () => {
    const snapshots: ProviderUsageSnapshot[] = [
      makeSnapshot({
        provider: "codex",
        quotas: [
          {
            id: "weekly",
            label: "Weekly Limit",
            remainingPercent: 25,
            remainingDisplay: "25% left",
            resetAt: "2026-02-25T05:00:00Z",
            status: "warning",
          },
          {
            id: "five-hour",
            label: "5 Hour Limit",
            remainingPercent: 10,
            remainingDisplay: "10% left",
            resetAt: "2026-02-24T04:00:00Z",
            status: "critical",
          },
        ],
      }),
    ];

    const alerts = deriveSnapshotAlerts(snapshots, new Date("2026-02-23T00:00:00Z"));
    expect(alerts).toHaveLength(2);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[1].severity).toBe("warning");
    expect(alerts[0].message).toContain("Resets in 1d 4h.");
    expect(alerts[1].message).toContain("Resets in 2d 5h.");
  });

  it("ignores quotas without a numeric remaining percentage", () => {
    const snapshots: ProviderUsageSnapshot[] = [
      makeSnapshot({
        provider: "claude",
        quotas: [{ id: "x", label: "Unknown", remainingDisplay: "n/a", status: "unknown" }],
      }),
    ];

    const alerts = deriveSnapshotAlerts(snapshots);
    expect(alerts).toHaveLength(0);
  });

  it("creates a warning alert for unavailable fallback snapshots", () => {
    const snapshots: ProviderUsageSnapshot[] = [
      makeSnapshot({
        provider: "copilot",
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
    ];

    const alerts = deriveSnapshotAlerts(snapshots);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("No Copilot token configured.");
  });
});

describe("summarizeAlerts", () => {
  it("counts warning and critical alerts", () => {
    const summary = summarizeAlerts([
      {
        id: "a",
        provider: "codex",
        fetchedAt: "2026-02-23T00:00:00Z",
        severity: "critical",
        label: "Weekly Limit",
        message: "10% left",
        recommendedAction: "Refresh",
      },
      {
        id: "b",
        provider: "claude",
        fetchedAt: "2026-02-23T00:00:00Z",
        severity: "warning",
        label: "5 Hour",
        message: "20% left",
        recommendedAction: "Refresh",
      },
    ]);

    expect(summary.critical).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.total).toBe(2);
  });
});
