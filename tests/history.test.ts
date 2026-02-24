import { describe, expect, it } from "vitest";
import { mergeQuotaHistory, summarizeQuotaHistory } from "../src/lib/history";
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
        status: "ok",
      },
    ],
  };
}

describe("history", () => {
  it("merges quota history points over time", () => {
    const previous = makeSnapshot(80, "2026-02-23T00:00:00Z");
    previous.quotaHistory = [{ quotaId: "weekly", points: [{ at: "2026-02-23T00:00:00Z", remainingPercent: 80 }] }];

    const merged = mergeQuotaHistory(previous, makeSnapshot(70, "2026-02-24T00:00:00Z"), "2026-02-24T00:00:00Z");
    expect(merged).toHaveLength(1);
    expect(merged[0].points).toHaveLength(2);
    expect(merged[0].points[1].remainingPercent).toBe(70);
  });

  it("summarizes sparkline and deltas", () => {
    const summary = summarizeQuotaHistory(
      {
        quotaId: "weekly",
        points: [
          { at: "2026-02-16T00:00:00Z", remainingPercent: 95 },
          { at: "2026-02-23T00:00:00Z", remainingPercent: 80 },
          { at: "2026-02-24T00:00:00Z", remainingPercent: 75 },
        ],
      },
      new Date("2026-02-24T12:00:00Z"),
    );

    expect(summary.sparkline.length).toBeGreaterThan(0);
    expect(summary.delta24h).toBeDefined();
    expect(summary.delta7d).toBeDefined();
  });
});
