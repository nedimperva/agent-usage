import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/browser-cookies", () => ({
  discoverBrowserCookieCandidates: vi.fn(),
}));

import { discoverBrowserCookieCandidates } from "../src/lib/browser-cookies";
import {
  fetchZedSnapshot,
  normalizeZedCookieHeader,
  parseZedAccountPage,
  resolveZedCookieCandidates,
} from "../src/providers/zed";

describe("normalizeZedCookieHeader", () => {
  it("extracts cookie from a copied request header block", () => {
    const value = normalizeZedCookieHeader(
      [
        "accept: text/html",
        "cookie: workos=abc123; __Secure-next-auth.session-token=xyz",
        "referer: https://dashboard.zed.dev/account",
      ].join("\n"),
    );

    expect(value).toBe("workos=abc123; __Secure-next-auth.session-token=xyz");
  });

  it("extracts cookie from a curl command", () => {
    const value = normalizeZedCookieHeader(
      "curl 'https://dashboard.zed.dev/account' -H 'Cookie: workos=abc; __Secure-next-auth.session-token=xyz'",
    );

    expect(value).toBe("workos=abc; __Secure-next-auth.session-token=xyz");
  });
});

describe("resolveZedCookieCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ZED_COOKIE_HEADER;
    delete process.env.ZED_COOKIE;
  });

  it("uses only manual input in manual mode", async () => {
    vi.mocked(discoverBrowserCookieCandidates).mockResolvedValue({
      candidates: [{ header: "browser=1", source: "Chrome" }],
      hasChromiumV20: false,
    });

    const result = await resolveZedCookieCandidates({
      cookieHeader: "Cookie: manual=1",
      cookieSourceMode: "manual",
      cachedCookieHeader: "cache=1",
    });

    expect(result.candidates).toEqual([{ header: "manual=1", source: "manual preference" }]);
  });

  it("includes env and discovered cookies in auto mode", async () => {
    process.env.ZED_COOKIE = "env=1";
    vi.mocked(discoverBrowserCookieCandidates).mockResolvedValue({
      candidates: [{ header: "browser=1", source: "Chrome Profile 1" }],
      hasChromiumV20: false,
    });

    const result = await resolveZedCookieCandidates({
      cookieHeader: "Cookie: manual=1",
      cachedCookieHeader: "cache=1",
      cookieSourceMode: "auto",
    });

    expect(result.candidates).toEqual([
      { header: "manual=1", source: "manual preference" },
      { header: "cache=1", source: "cache" },
      { header: "env=1", source: "environment" },
      { header: "browser=1", source: "Chrome Profile 1" },
    ]);
  });
});

describe("parseZedAccountPage", () => {
  it("parses included credit and spend limit from embedded JSON", () => {
    const html = `
      <html>
        <body>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "account": {
                    "planName": "Zed Pro",
                    "billingDate": "2026-03-31T00:00:00Z",
                    "includedCredit": { "limit": 5, "used": 1.25 },
                    "tokenSpendLimit": { "limit": 20, "used": 12.5, "blocked": false }
                  }
                }
              }
            }
          </script>
        </body>
      </html>
    `;

    expect(parseZedAccountPage(html)).toEqual({
      planLabel: "Zed Pro",
      includedCreditLimit: 5,
      includedCreditUsed: 1.25,
      tokenSpendLimit: 20,
      cycleSpend: 12.5,
      spendLimitBlocked: false,
      billingDate: "2026-03-31T00:00:00.000Z",
    });
  });

  it("parses absolute-dollar fallback content from visible text", () => {
    const html = `
      <html>
        <body>
          <main>
            <h1>Zed Pro</h1>
            <section>Included Credit USD 5.00</section>
            <section>Maximum Token Spend $20.00</section>
            <section>Current Cycle Spend USD 12.50</section>
            <section>Billing Date March 31, 2026</section>
          </main>
        </body>
      </html>
    `;

    expect(parseZedAccountPage(html)).toEqual({
      planLabel: "Zed Pro",
      includedCreditLimit: 5,
      tokenSpendLimit: 20,
      cycleSpend: 12.5,
      billingDate: "2026-03-31T00:00:00.000Z",
    });
  });
});

describe("fetchZedSnapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps parsed account data to included-credit and spend-limit quotas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `
            <html>
              <body>
                <script id="__NEXT_DATA__" type="application/json">
                  {
                    "props": {
                      "pageProps": {
                        "account": {
                          "planName": "Zed Pro",
                          "billingDate": "2026-03-31T00:00:00Z",
                          "includedCredit": { "limit": 5, "used": 1.5 },
                          "tokenSpendLimit": { "limit": 25, "used": 12.5, "blocked": true }
                        }
                      }
                    }
                  }
                </script>
              </body>
            </html>
          `,
          { status: 200 },
        ),
      ),
    );

    const snapshot = await fetchZedSnapshot({
      cookieHeader: "zed=session",
      cookieSourceMode: "manual",
    });

    expect(snapshot.provider).toBe("zed");
    expect(snapshot.planLabel).toBe("Zed Pro");
    expect(snapshot.quotas.map((quota) => quota.label)).toEqual(["Included Credit", "Token Spend Limit"]);
    expect(snapshot.quotas[0].remainingDisplay).toBe("USD 3.50 left of USD 5.00");
    expect(snapshot.quotas[1].remainingDisplay).toBe("USD 12.50 left of USD 25.00");
    expect(snapshot.quotas[1].status).toBe("critical");
    expect(snapshot.highlights).toContain("Hosted usage blocked by spend limit.");
  });

  it("throws an auth error when the account page is actually a sign-in page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body><h1>Sign in</h1><button>Continue with GitHub</button></body></html>", {
          status: 200,
        }),
      ),
    );

    await expect(
      fetchZedSnapshot({
        cookieHeader: "zed=session",
        cookieSourceMode: "manual",
      }),
    ).rejects.toThrow("Zed session cookie is invalid or expired.");
  });
});
