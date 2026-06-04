import { describe, expect, it } from "vitest";
import {
  OPTIONAL_PROVIDERS,
  PROVIDER_ORDER,
  providerHasConfiguredCredential,
  providerShouldAutoShow,
} from "../src/lib/provider-registry";

describe("provider registry", () => {
  it("registers the prioritized CodexBar-inspired providers as optional", () => {
    expect(PROVIDER_ORDER).toContain("openai");
    expect(PROVIDER_ORDER).toContain("claude-admin");
    expect(PROVIDER_ORDER).toContain("deepseek");
    expect(PROVIDER_ORDER).toContain("moonshot");
    expect(PROVIDER_ORDER).toContain("mistral");
    expect(PROVIDER_ORDER).toContain("perplexity");
    expect(PROVIDER_ORDER).toContain("grok");
    expect(PROVIDER_ORDER).toContain("groqcloud");
    expect(PROVIDER_ORDER).toContain("windsurf");
    expect(PROVIDER_ORDER).toContain("augment");
    expect(PROVIDER_ORDER).toContain("kiro");
    expect(PROVIDER_ORDER).toContain("warp");
    expect(PROVIDER_ORDER).toContain("opencode-go");
    expect(OPTIONAL_PROVIDERS).toContain("openai");
  });

  it("detects configured credentials through preferences and env", () => {
    expect(providerHasConfiguredCredential("openai", { openaiAdminApiKey: "sk-admin" }, {})).toBe(true);
    expect(providerHasConfiguredCredential("deepseek", {}, { DEEPSEEK_API_KEY: "sk" })).toBe(true);
    expect(providerHasConfiguredCredential("warp", {}, {})).toBe(false);
  });

  it("keeps optional providers hidden until configured or successful", () => {
    expect(providerShouldAutoShow("deepseek", {}, {})).toBe(false);
    expect(
      providerShouldAutoShow(
        "deepseek",
        {},
        {
          deepseek: {
            provider: "deepseek",
            fetchedAt: "2026-02-28T00:00:00Z",
            quotas: [{ id: "balance", label: "Balance", remainingDisplay: "ok", status: "ok" }],
            source: "api",
          },
        },
      ),
    ).toBe(true);
  });
});
