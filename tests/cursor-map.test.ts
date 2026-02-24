import { describe, expect, it } from "vitest";
import { mapCursorUsageToQuotas } from "../src/providers/cursor";

describe("mapCursorUsageToQuotas", () => {
  it("maps included, on-demand, and legacy request usage", () => {
    const quotas = mapCursorUsageToQuotas(
      {
        billingCycleEnd: "2026-02-28T00:00:00Z",
        individualUsage: {
          plan: {
            used: 550,
            limit: 2000,
            remaining: 1450,
          },
          onDemand: {
            used: 1250,
            limit: 5000,
            remaining: 3750,
          },
        },
      },
      {
        "gpt-4": {
          numRequestsTotal: 80,
          maxRequestUsage: 500,
        },
      },
    );

    expect(quotas.some((quota) => quota.id === "cursor-plan")).toBe(true);
    expect(quotas.some((quota) => quota.id === "cursor-on-demand")).toBe(true);
    expect(quotas.some((quota) => quota.id === "cursor-legacy-requests")).toBe(true);
    expect(quotas.find((quota) => quota.id === "cursor-plan")?.remainingDisplay).toContain("USD");
  });
});
