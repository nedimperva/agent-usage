import { describe, expect, it } from "vitest";
import { mapCursorDesktopAuthRows } from "../src/providers/cursor";

describe("mapCursorDesktopAuthRows", () => {
  it("maps sqlite cursorAuth/* keys", () => {
    const parsed = mapCursorDesktopAuthRows([
      { key: "cursorAuth/accessToken", value: "access-token" },
      { key: "cursorAuth/refreshToken", value: "refresh-token" },
      { key: "cursorAuth/cachedEmail", value: "dev@example.com" },
      { key: "cursorAuth/stripeMembershipType", value: "pro" },
      { key: "cursorAuth/stripeSubscriptionStatus", value: "active" },
    ]);

    expect(parsed).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      cachedEmail: "dev@example.com",
      stripeMembershipType: "pro",
      stripeSubscriptionStatus: "active",
    });
  });

  it("maps normalized python fallback keys", () => {
    const parsed = mapCursorDesktopAuthRows([
      { key: "accessToken", value: "access-token" },
      { key: "refreshToken", value: "refresh-token" },
      { key: "cachedEmail", value: "dev@example.com" },
      { key: "stripeMembershipType", value: "pro" },
      { key: "stripeSubscriptionStatus", value: "active" },
    ]);

    expect(parsed).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      cachedEmail: "dev@example.com",
      stripeMembershipType: "pro",
      stripeSubscriptionStatus: "active",
    });
  });

  it("extracts nested auth fields from JSON payload values", () => {
    const parsed = mapCursorDesktopAuthRows([
      {
        key: "cursorAuth/session",
        value: JSON.stringify({
          tokenBundle: {
            accessToken: "nested-access",
            refreshToken: "nested-refresh",
          },
          profile: {
            cachedEmail: "nested@example.com",
          },
          billing: {
            stripeMembershipType: "business",
            stripeSubscriptionStatus: "trialing",
          },
        }),
      },
    ]);

    expect(parsed).toEqual({
      accessToken: "nested-access",
      refreshToken: "nested-refresh",
      cachedEmail: "nested@example.com",
      stripeMembershipType: "business",
      stripeSubscriptionStatus: "trialing",
    });
  });

  it("accepts sqlite blob/byte values for direct keys", () => {
    const parsed = mapCursorDesktopAuthRows([
      { key: "cursorAuth/accessToken", value: Buffer.from("blob-access", "utf8") },
      { key: "cursorAuth/refreshToken", value: Buffer.from("blob-refresh", "utf8") },
    ]);

    expect(parsed).toEqual({
      accessToken: "blob-access",
      refreshToken: "blob-refresh",
    });
  });
});
