import { describe, expect, it } from "vitest";
import { extractCopilotQuotaItems } from "../src/providers/copilot";

describe("extractCopilotQuotaItems", () => {
  it("builds quota items from copilot_internal response", () => {
    const payload = {
      copilot_plan: "individual",
      quota_snapshots: {
        premium_interactions: {
          percent_remaining: 5,
          resets_at: "2026-02-28T00:00:00Z",
        },
        chat: {
          percent_remaining: 72,
          next_reset_at: 1772236800,
        },
      },
    };

    const quotas = extractCopilotQuotaItems(payload);
    expect(quotas.some((quota) => quota.id === "copilot-premium")).toBe(true);
    expect(quotas.some((quota) => quota.id === "copilot-chat")).toBe(true);
    expect(quotas.find((quota) => quota.id === "copilot-premium")?.resetAt).toBe("2026-02-28T00:00:00.000Z");
    expect(quotas.find((quota) => quota.id === "copilot-chat")?.resetAt).toBe("2026-02-28T00:00:00.000Z");
  });

  it("returns fallback item when no useful quotas exist", () => {
    const quotas = extractCopilotQuotaItems({});
    expect(quotas).toHaveLength(1);
    expect(quotas[0].id).toBe("copilot-empty");
  });

  it("uses first of next month when copilot reset date is not provided", () => {
    const now = new Date("2026-02-23T14:00:00Z");
    const payload = {
      quota_snapshots: {
        premium_interactions: {
          percent_remaining: 12,
        },
      },
    };

    const quotas = extractCopilotQuotaItems(payload, now);
    expect(quotas[0].id).toBe("copilot-premium");
    expect(quotas[0].resetAt).toBe("2026-03-01T00:00:00.000Z");
  });
});
