import { describe, expect, it } from "vitest";
import { mapClaudeAdminUsage } from "../src/providers/claude-admin";
import { mapDeepSeekBalance } from "../src/providers/deepseek";
import { mapGroqCloudUsage } from "../src/providers/groqcloud";
import { mapKiroUsage } from "../src/providers/kiro";
import { mapMoonshotBalance } from "../src/providers/moonshot";
import { mapOpenAIUsageToQuotas } from "../src/providers/openai";
import { mapPerplexityUsage } from "../src/providers/perplexity";
import { mapWarpUsage } from "../src/providers/warp";

describe("new provider mappings", () => {
  it("maps OpenAI admin spend, requests, tokens, and credit fallback", () => {
    const quotas = mapOpenAIUsageToQuotas(
      {
        data: [
          {
            start_time: 1772236800,
            results: [{ amount_value: 12.5 }],
          },
        ],
      },
      {
        data: [
          {
            start_time: 1772236800,
            results: [{ num_model_requests: 42, input_tokens: 1000, output_tokens: 500 }],
          },
        ],
      },
      { total_available: 7, total_granted: 10, total_used: 3 },
      new Date("2026-02-28T12:00:00Z"),
    );

    expect(quotas.map((quota) => quota.id)).toContain("openai-api-spend-30d");
    expect(quotas.map((quota) => quota.id)).toContain("openai-api-requests-30d");
    expect(quotas.map((quota) => quota.id)).toContain("openai-api-tokens-30d");
    expect(quotas.map((quota) => quota.id)).toContain("openai-api-credits");
  });

  it("maps Claude Admin usage report fields", () => {
    const quotas = mapClaudeAdminUsage({
      total_cost: 18.25,
      message_count: 120,
      input_tokens: 10000,
      output_tokens: 5000,
    });

    expect(quotas[0].label).toBe("Admin Spend (30d)");
    expect(quotas.map((quota) => quota.id)).toContain("claude-admin-messages-30d");
    expect(quotas.map((quota) => quota.id)).toContain("claude-admin-tokens-30d");
  });

  it("maps DeepSeek paid and granted balances", () => {
    const quotas = mapDeepSeekBalance({
      balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "2.50", topped_up_balance: "10" }],
    });

    expect(quotas[0].remainingDisplay).toContain("USD 12.50");
    expect(quotas[1].remainingDisplay).toContain("Granted USD 2.50");
  });

  it("maps Moonshot balance payloads", () => {
    const quotas = mapMoonshotBalance({
      data: { available_balance: 9.75, granted_balance: 1.25, currency: "CNY" },
    });

    expect(quotas[0].remainingDisplay).toContain("CNY 9.75");
    expect(quotas[1].remainingDisplay).toContain("CNY 1.25");
  });

  it("maps Perplexity credits with renewal date", () => {
    const quotas = mapPerplexityUsage({
      availableCredits: 80,
      creditLimit: 100,
      usedCredits: 20,
      renewalDate: "2026-03-01T00:00:00Z",
    });

    expect(quotas[0].remainingPercent).toBe(80);
    expect(quotas[1].resetAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("maps GroqCloud enterprise counters", () => {
    const quotas = mapGroqCloudUsage({ total_requests: 500, total_tokens: 12000, cache_hits: 12 }, true);

    expect(quotas.map((quota) => quota.id)).toEqual(["groqcloud-requests", "groqcloud-tokens", "groqcloud-cache-hits"]);
  });

  it("maps Kiro CLI JSON usage", () => {
    const quotas = mapKiroUsage(
      {
        monthlyUsedPercent: 40,
        creditsUsed: 20,
        creditsLimit: 50,
        bonusCredits: 5,
      },
      "",
    );

    expect(quotas[0].remainingPercent).toBe(60);
    expect(quotas.map((quota) => quota.id)).toContain("kiro-bonus-credits");
  });

  it("maps Warp request and credit limits", () => {
    const quotas = mapWarpUsage({
      data: {
        viewer: {
          usage: {
            requestsUsed: 10,
            requestsLimit: 100,
            creditsUsed: 2,
            creditsLimit: 20,
          },
        },
      },
    });

    expect(quotas[0].remainingPercent).toBe(90);
    expect(quotas[1].remainingPercent).toBe(90);
  });
});
