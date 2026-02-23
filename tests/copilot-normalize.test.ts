import { describe, expect, it } from "vitest";
import { extractCopilotQuotaItems } from "../src/providers/copilot";

describe("extractCopilotQuotaItems", () => {
  it("builds quota items from copilot_internal response", () => {
    const payload = {
      copilot_plan: "individual",
      quota_snapshots: {
        premium_interactions: {
          percent_remaining: 5,
        },
        chat: {
          percent_remaining: 72,
        },
      },
    };

    const quotas = extractCopilotQuotaItems(payload);
    expect(quotas.some((quota) => quota.id === "copilot-premium")).toBe(true);
    expect(quotas.some((quota) => quota.id === "copilot-chat")).toBe(true);
  });

  it("returns fallback item when no useful quotas exist", () => {
    const quotas = extractCopilotQuotaItems({});
    expect(quotas).toHaveLength(1);
    expect(quotas[0].id).toBe("copilot-empty");
  });
});
