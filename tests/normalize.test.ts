import { describe, expect, it } from "vitest";
import { clampPercent, parseDateLike, statusFromRemainingPercent } from "../src/lib/normalize";

describe("statusFromRemainingPercent", () => {
  it("returns critical for values at or below 10", () => {
    expect(statusFromRemainingPercent(9.99)).toBe("critical");
    expect(statusFromRemainingPercent(10)).toBe("critical");
  });

  it("returns warning for values above 10 up to 25", () => {
    expect(statusFromRemainingPercent(10.01)).toBe("warning");
    expect(statusFromRemainingPercent(25)).toBe("warning");
  });

  it("returns ok for values above 25", () => {
    expect(statusFromRemainingPercent(25.01)).toBe("ok");
  });

  it("returns unknown when percentage is undefined", () => {
    expect(statusFromRemainingPercent(undefined)).toBe("unknown");
  });
});

describe("clampPercent", () => {
  it("clamps values outside [0, 100]", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(200)).toBe(100);
  });
});

describe("parseDateLike", () => {
  it("parses ISO strings and unix seconds", () => {
    expect(parseDateLike("2026-02-28T00:00:00Z")).toBe("2026-02-28T00:00:00.000Z");
    expect(parseDateLike(1772236800)).toBe("2026-02-28T00:00:00.000Z");
  });
});
