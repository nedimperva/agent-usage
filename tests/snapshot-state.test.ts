import { describe, expect, it } from "vitest";
import { mergeDerivedSnapshot } from "../src/lib/snapshot-state";
import { ProviderUsageSnapshot } from "../src/models/usage";

function makeSnapshot(remainingPercent: number, fetchedAt: string): ProviderUsageSnapshot {
  return {
    provider: "codex",
    fetchedAt,
    source: "api",
    quotas: [
      {
        id: "weekly",
        label: "Weekly Limit",
        remainingPercent,
        remainingDisplay: `${remainingPercent}% left`,
        resetAt: "2026-02-28T00:00:00Z",
        windowStartAt: "2026-02-21T00:00:00Z",
        windowDurationSeconds: 7 * 24 * 60 * 60,
        status: "ok",
      },
    ],
  };
}

describe("mergeDerivedSnapshot", () => {
  it("preserves history and attaches forecasts on merge", () => {
    const previous = makeSnapshot(80, "2026-02-23T00:00:00Z");
    previous.quotaHistory = [
      {
        quotaId: "weekly",
        points: [{ at: "2026-02-23T00:00:00Z", remainingPercent: 80, sampleSource: "manual" }],
      },
    ];

    const merged = mergeDerivedSnapshot(
      previous,
      makeSnapshot(70, "2026-02-23T06:00:00Z"),
      "2026-02-23T06:00:00Z",
      "background",
      new Date("2026-02-23T06:00:00Z"),
    );

    expect(merged.quotaHistory?.[0].points).toHaveLength(2);
    expect(merged.quotaHistory?.[0].points[1].sampleSource).toBe("background");
    expect(merged.quotas[0].forecast).toBeDefined();
  });
});
