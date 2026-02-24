import { describe, expect, it } from "vitest";
import { mapGeminiUsageToQuotas } from "../src/providers/gemini";

describe("mapGeminiUsageToQuotas", () => {
  it("groups quotas into pro and flash model buckets", () => {
    const quotas = mapGeminiUsageToQuotas({
      buckets: [
        { modelId: "gemini-2.5-pro", remainingFraction: 0.65, resetTime: "2026-02-28T00:00:00Z" },
        { modelId: "gemini-2.5-pro", remainingFraction: 0.4, resetTime: "2026-02-28T01:00:00Z" },
        { modelId: "gemini-2.5-flash", remainingFraction: 0.9, resetTime: "2026-02-28T00:00:00Z" },
      ],
    });

    expect(quotas.some((quota) => quota.id === "gemini-pro")).toBe(true);
    expect(quotas.some((quota) => quota.id === "gemini-flash")).toBe(true);
    expect(quotas.find((quota) => quota.id === "gemini-pro")?.remainingPercent).toBeCloseTo(40);
  });

  it("falls back to a generic quota when model names are not pro/flash", () => {
    const quotas = mapGeminiUsageToQuotas({
      buckets: [{ modelId: "gemini-2.0-experimental", remainingFraction: 0.75, resetTime: "2026-02-28T00:00:00Z" }],
    });

    expect(quotas).toHaveLength(1);
    expect(quotas[0].id).toBe("gemini-models");
    expect(quotas[0].remainingPercent).toBeCloseTo(75);
  });
});
