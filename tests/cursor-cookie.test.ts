import { describe, expect, it } from "vitest";
import { normalizeCursorCookieHeader } from "../src/providers/cursor";

describe("normalizeCursorCookieHeader", () => {
  it("normalizes a plain cookie string", () => {
    const value = normalizeCursorCookieHeader("a=1; b=2; c=3");
    expect(value).toBe("a=1; b=2; c=3");
  });

  it("extracts cookie from a full request-header block", () => {
    const value = normalizeCursorCookieHeader(
      [
        "accept: application/json",
        "cookie: WorkosCursorSessionToken=abc123; __Secure-next-auth.session-token=xyz",
        "referer: https://cursor.com/dashboard",
      ].join("\n"),
    );

    expect(value).toBe("WorkosCursorSessionToken=abc123; __Secure-next-auth.session-token=xyz");
  });

  it("drops malformed segments", () => {
    const value = normalizeCursorCookieHeader("Cookie: a=1; malformed; b=2");
    expect(value).toBe("a=1; b=2");
  });

  it("extracts cookie from a curl command", () => {
    const value = normalizeCursorCookieHeader(
      "curl 'https://cursor.com/api/usage-summary' -H 'Accept: application/json' -H 'Cookie: WorkosCursorSessionToken=abc; __Secure-next-auth.session-token=xyz'",
    );
    expect(value).toBe("WorkosCursorSessionToken=abc; __Secure-next-auth.session-token=xyz");
  });
});
