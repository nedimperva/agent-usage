import { describe, expect, it } from "vitest";
import { extractCopilotQuotaItems } from "../src/providers/copilot";

describe("extractCopilotQuotaItems", () => {
  it("adds a monthly window fallback when reset timestamps are missing", () => {
    const quotas = extractCopilotQuotaItems(
      {
        quota_snapshots: {
          premium_interactions: {
            percent_remaining: 64,
          },
        },
      },
      new Date("2026-02-23T12:00:00Z"),
    );

    const premium = quotas.find((quota) => quota.id === "copilot-premium");
    expect(premium?.resetAt).toBe("2026-03-01T00:00:00.000Z");
    expect(premium?.windowStartAt).toBe("2026-02-01T00:00:00.000Z");
    expect(premium?.windowDurationSeconds).toBeGreaterThan(0);
  });
});
