import { describe, expect, it } from "vitest";
import { deriveQuotaForecast } from "../src/lib/forecast";
import { ProviderUsageSnapshot, QuotaHistorySeries, QuotaItem } from "../src/models/usage";

function makeQuota(overrides: Partial<QuotaItem> = {}): QuotaItem {
  return {
    id: "weekly",
    label: "Weekly Limit",
    remainingPercent: 40,
    remainingDisplay: "40% left",
    resetAt: "2026-02-23T20:00:00Z",
    windowStartAt: "2026-02-22T20:00:00Z",
    windowDurationSeconds: 24 * 60 * 60,
    status: "ok",
    ...overrides,
  };
}

function makeSeries(points: QuotaHistorySeries["points"]): QuotaHistorySeries {
  return {
    quotaId: "weekly",
    points,
  };
}

const snapshotContext: Pick<ProviderUsageSnapshot, "staleAfterSeconds"> = {
  staleAfterSeconds: 8 * 60 * 60,
};

describe("deriveQuotaForecast", () => {
  it("derives deficit pace, runout, and confidence from same-cycle samples", () => {
    const forecast = deriveQuotaForecast(
      makeQuota(),
      makeSeries([
        { at: "2026-02-23T00:00:00Z", remainingPercent: 70, resetAt: "2026-02-23T20:00:00Z", sampleSource: "background" },
        { at: "2026-02-23T04:00:00Z", remainingPercent: 55, resetAt: "2026-02-23T20:00:00Z", sampleSource: "background" },
        { at: "2026-02-23T08:00:00Z", remainingPercent: 40, resetAt: "2026-02-23T20:00:00Z", sampleSource: "background" },
      ]),
      snapshotContext,
      new Date("2026-02-23T08:00:00Z"),
    );

    expect(forecast?.paceStatus).toBe("deficit");
    expect(forecast?.deficitPercent).toBeGreaterThan(5);
    expect(forecast?.estimatedRunoutAt).toBeDefined();
    expect(forecast?.projectedRemainingAtReset).toBeLessThan(0);
    expect(forecast?.confidence).toBe("medium");
  });

  it("shows on-pace without a runout estimate when history is too thin", () => {
    const forecast = deriveQuotaForecast(
      makeQuota({ remainingPercent: 48 }),
      makeSeries([
        { at: "2026-02-23T08:00:00Z", remainingPercent: 48, resetAt: "2026-02-23T20:00:00Z", sampleSource: "manual" },
      ]),
      snapshotContext,
      new Date("2026-02-23T08:00:00Z"),
    );

    expect(forecast?.paceStatus).toBe("on-pace");
    expect(forecast?.estimatedRunoutAt).toBeUndefined();
    expect(forecast?.hiddenReason).toContain("Need at least 2");
  });
});
