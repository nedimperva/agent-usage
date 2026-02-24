import { describe, expect, it } from "vitest";
import { mapClaudeUsageToQuotas } from "../src/providers/claude";

describe("mapClaudeUsageToQuotas", () => {
  it("maps oauth usage windows and extra budget", () => {
    const quotas = mapClaudeUsageToQuotas({
      five_hour: { utilization: 0, resets_at: "2026-02-23T16:00:00Z" },
      seven_day: { utilization: 95, resets_at: "2026-02-28T00:00:00Z" },
      seven_day_oauth_apps: { utilization: 80, resets_at: "2026-02-28T00:00:00Z" },
      seven_day_sonnet: { utilization: 40, resets_at: "2026-02-28T00:00:00Z" },
      seven_day_opus: { utilization: 60, resets_at: "2026-02-28T00:00:00Z" },
      extra_usage: {
        is_enabled: true,
        used_credits: 2200,
        monthly_limit: 10000,
        currency: "USD",
      },
    });

    expect(quotas.some((quota) => quota.id === "claude-five-hour")).toBe(true);
    expect(quotas.some((quota) => quota.id === "claude-weekly")).toBe(true);
    expect(quotas.some((quota) => quota.id === "claude-oauth-apps-weekly")).toBe(true);
    expect(quotas.some((quota) => quota.id === "claude-sonnet-weekly")).toBe(true);
    expect(quotas.some((quota) => quota.id === "claude-opus-weekly")).toBe(true);
    expect(quotas.some((quota) => quota.id === "claude-extra-usage")).toBe(true);
    expect(quotas.find((quota) => quota.id === "claude-extra-usage")?.remainingDisplay).toContain("USD");
  });
});
