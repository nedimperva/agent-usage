import { describe, expect, it } from "vitest";
import { clampPercent, statusFromRemainingPercent } from "../src/lib/normalize";

describe("statusFromRemainingPercent", () => {
  it("returns critical for values below 10", () => {
    expect(statusFromRemainingPercent(9.99)).toBe("critical");
  });

  it("returns warning for values from 10 to 25", () => {
    expect(statusFromRemainingPercent(10)).toBe("warning");
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
