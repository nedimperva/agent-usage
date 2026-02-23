import { describe, expect, it } from "vitest";
import { parseCodexImport } from "../src/providers/codex";

describe("parseCodexImport", () => {
  it("parses quotas from JSON payload", () => {
    const snapshot = parseCodexImport(
      JSON.stringify({
        quotas: [
          {
            label: "Weekly Limit",
            remainingPercent: 68,
            trendBadge: "+10%",
            resetAt: "2026-02-25T00:00:00Z",
          },
        ],
      }),
      new Date("2026-02-23T00:00:00Z"),
    );

    expect(snapshot.provider).toBe("codex");
    expect(snapshot.quotas).toHaveLength(1);
    expect(snapshot.quotas[0].label).toBe("Weekly Limit");
    expect(snapshot.quotas[0].remainingPercent).toBe(68);
    expect(snapshot.quotas[0].status).toBe("ok");
  });

  it("parses usage lines from plain text", () => {
    const snapshot = parseCodexImport("Weekly Limit: 5% left +25% reset Mar 1", new Date("2026-02-23T00:00:00Z"));
    expect(snapshot.quotas).toHaveLength(1);
    expect(snapshot.quotas[0].label).toBe("Weekly Limit");
    expect(snapshot.quotas[0].remainingPercent).toBe(5);
    expect(snapshot.quotas[0].status).toBe("critical");
  });

  it("throws when payload cannot be parsed", () => {
    expect(() => parseCodexImport("this is not parseable")).toThrow(/Could not parse any usage rows/i);
  });
});
