import { describe, expect, it } from "vitest";
import { mapAntigravityResponseToQuotas } from "../src/providers/antigravity";

describe("mapAntigravityResponseToQuotas", () => {
  it("picks Claude, Gemini Pro, and Gemini Flash in priority order", () => {
    const quotas = mapAntigravityResponseToQuotas({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: "Claude Sonnet",
              modelOrAlias: { model: "claude-sonnet" },
              quotaInfo: { remainingFraction: 0.55, resetTime: "2026-03-01T00:00:00Z" },
            },
            {
              label: "Gemini Pro Low",
              modelOrAlias: { model: "gemini-pro-low" },
              quotaInfo: { remainingFraction: 0.25, resetTime: "2026-03-01T00:00:00Z" },
            },
            {
              label: "Gemini Flash",
              modelOrAlias: { model: "gemini-flash" },
              quotaInfo: { remainingFraction: 0.9, resetTime: "2026-03-01T00:00:00Z" },
            },
          ],
        },
      },
    });

    expect(quotas).toHaveLength(3);
    expect(quotas[0].label).toBe("Claude");
    expect(quotas[1].label).toBe("Gemini Pro");
    expect(quotas[2].label).toBe("Gemini Flash");
  });

  it("keeps pro/claude models when remainingFraction is missing but resetTime exists", () => {
    const quotas = mapAntigravityResponseToQuotas({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: "Claude Sonnet 4.6 (Thinking)",
              modelOrAlias: { model: "claude-sonnet-thinking" },
              quotaInfo: { resetTime: "2026-03-01T00:00:00Z" },
            },
            {
              label: "Gemini 3.1 Pro (Low)",
              modelOrAlias: { model: "gemini-pro-low" },
              quotaInfo: { resetTime: "2026-03-01T00:00:00Z" },
            },
            {
              label: "Gemini 3 Flash",
              modelOrAlias: { model: "gemini-flash" },
              quotaInfo: { remainingFraction: 0.8, resetTime: "2026-03-01T00:00:00Z" },
            },
          ],
        },
      },
    });

    expect(quotas).toHaveLength(3);
    expect(quotas.map((quota) => quota.label)).toEqual(["Claude", "Gemini Pro", "Gemini Flash"]);
    expect(quotas.find((quota) => quota.label === "Claude")?.remainingPercent).toBeUndefined();
    expect(quotas.find((quota) => quota.label === "Gemini Pro")?.remainingPercent).toBeUndefined();
  });

  it("falls back to lowest remaining quotas when preferred labels are absent", () => {
    const quotas = mapAntigravityResponseToQuotas({
      clientModelConfigs: [
        {
          label: "Model A",
          modelOrAlias: { model: "model-a" },
          quotaInfo: { remainingFraction: 0.8 },
        },
        {
          label: "Model B",
          modelOrAlias: { model: "model-b" },
          quotaInfo: { remainingFraction: 0.2 },
        },
        {
          label: "Model C",
          modelOrAlias: { model: "model-c" },
          quotaInfo: { remainingFraction: 0.4 },
        },
        {
          label: "Model D",
          modelOrAlias: { model: "model-d" },
          quotaInfo: { remainingFraction: 0.6 },
        },
      ],
    });

    expect(quotas).toHaveLength(3);
    expect(quotas[0].label).toBe("Model B");
    expect(quotas[1].label).toBe("Model C");
    expect(quotas[2].label).toBe("Model D");
  });

  it("merges user and command model config sources before selecting top quotas", () => {
    const quotas = mapAntigravityResponseToQuotas({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              label: "Gemini 3 Flash",
              modelOrAlias: { model: "gemini-flash" },
              quotaInfo: { remainingFraction: 0.72, resetTime: "2026-03-01T00:00:00Z" },
            },
          ],
        },
      },
      clientModelConfigs: [
        {
          label: "Claude Sonnet 4.6",
          modelOrAlias: { model: "claude-sonnet" },
          quotaInfo: { remainingFraction: 0.64, resetTime: "2026-03-01T00:00:00Z" },
        },
        {
          label: "Gemini 3.1 Pro (Low)",
          modelOrAlias: { model: "gemini-pro-low" },
          quotaInfo: { remainingFraction: 0.45, resetTime: "2026-03-01T00:00:00Z" },
        },
      ],
    });

    expect(quotas.map((quota) => quota.label)).toEqual(["Claude", "Gemini Pro", "Gemini Flash"]);
  });
});
