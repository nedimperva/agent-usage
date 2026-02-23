import { describe, expect, it } from "vitest";
import { mapCodexUsageToQuotas } from "../src/providers/codex";

describe("mapCodexUsageToQuotas", () => {
  it("maps primary/secondary windows to quota rows", () => {
    const quotas = mapCodexUsageToQuotas({
      rate_limit: {
        primary_window: {
          used_percent: 22,
          reset_at: 1771804800,
          limit_window_seconds: 5 * 60 * 60,
        },
        secondary_window: {
          used_percent: 95,
          reset_at: 1772064000,
          limit_window_seconds: 7 * 24 * 60 * 60,
        },
      },
      credits: {
        has_credits: true,
        balance: 12.5,
      },
    });

    expect(quotas.some((quota) => quota.label === "5 Hour Limit")).toBe(true);
    expect(quotas.some((quota) => quota.label === "Weekly Limit")).toBe(true);
    expect(quotas.some((quota) => quota.id === "codex-credits")).toBe(true);
  });
});
