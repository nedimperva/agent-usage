import { describe, expect, it } from "vitest";
import {
  buildAntigravityLogAdvisorySnapshot,
  extractLatestAntigravityQuotaLogHint,
  isAntigravityLogAdvisorySnapshot,
  parseAntigravityResetDuration,
} from "../src/providers/antigravity";

describe("parseAntigravityResetDuration", () => {
  it("parses compact hour-minute-second duration strings", () => {
    expect(parseAntigravityResetDuration("42h1m20s")).toBe(42 * 60 * 60 + 60 + 20);
  });

  it("parses day and hour duration strings", () => {
    expect(parseAntigravityResetDuration("2d3h")).toBe(2 * 24 * 60 * 60 + 3 * 60 * 60);
  });

  it("rejects malformed duration strings", () => {
    expect(parseAntigravityResetDuration("about 4 hours")).toBeUndefined();
  });
});

describe("extractLatestAntigravityQuotaLogHint", () => {
  it("extracts the newest non-expired RESOURCE_EXHAUSTED hint", () => {
    const logText = `
2026-03-18 13:31:12.852 [info] E0318 13:31:12.851695 13896 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): You have exhausted your capacity on this model. Your quota will reset after 42h1m20s.
2026-03-18 13:32:27.224 [info] E0318 13:32:27.224242 13896 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): You have exhausted your capacity on this model. Your quota will reset after 42h0m5s.
`.trim();

    const hint = extractLatestAntigravityQuotaLogHint(logText, "C:\\Logs\\Antigravity.log", new Date("2026-03-19T00:00:00Z"));

    expect(hint).toBeDefined();
    expect(hint?.logPath).toBe("C:\\Logs\\Antigravity.log");
    expect(hint?.resetInSeconds).toBe(42 * 60 * 60 + 5);
    expect(hint?.resetInDisplay).toBe("42h 0m 5s");
    expect(Date.parse(hint?.estimatedResetAt ?? "") - Date.parse(hint?.observedAt ?? "")).toBe(
      hint!.resetInSeconds * 1000,
    );
  });

  it("ignores exhausted hints whose estimated reset has already passed", () => {
    const logText = `
2026-03-18 08:00:00.000 [info] agent executor error: RESOURCE_EXHAUSTED (code 429): You have exhausted your capacity on this model. Your quota will reset after 1h.
`.trim();

    const hint = extractLatestAntigravityQuotaLogHint(logText, "C:\\Logs\\Antigravity.log", new Date("2026-03-18T12:00:00Z"));

    expect(hint).toBeUndefined();
  });
});

describe("buildAntigravityLogAdvisorySnapshot", () => {
  it("marks advisory snapshots so the sampler can treat them as skipped", () => {
    const snapshot = buildAntigravityLogAdvisorySnapshot(
      {
        logPath: "C:\\Logs\\Antigravity.log",
        observedAt: "2026-03-18T12:00:00.000Z",
        resetInSeconds: 3600,
        resetInDisplay: "1h",
        estimatedResetAt: "2026-03-18T13:00:00.000Z",
        message: "RESOURCE_EXHAUSTED",
      },
      "No Antigravity Server URL found.",
    );

    expect(snapshot.quotas[0]?.label).toBe("Recent exhaustion hint");
    expect(snapshot.errors).toContain("Live quotas unavailable: No Antigravity Server URL found.");
    expect(isAntigravityLogAdvisorySnapshot(snapshot)).toBe(true);
  });
});
