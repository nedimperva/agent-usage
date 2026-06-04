import {
  buildCountQuota,
  buildSnapshot,
  parseJsonObjectFromText,
  readFirstDate,
  readFirstNumber,
  readFirstString,
  runCommandText,
} from "./provider-helpers";

function parsePercent(text: string, label: string): number | undefined {
  const pattern = new RegExp(`${label}[^0-9]{0,40}([0-9]+(?:\\.[0-9]+)?)\\s*%`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : undefined;
}

export function mapKiroUsage(raw: unknown, text: string) {
  const monthlyUsed =
    readFirstNumber(raw, ["monthlyUsedPercent", "monthly_used_percent", "usedPercent", "usagePercent"]) ??
    parsePercent(text, "monthly");
  const creditsUsed = readFirstNumber(raw, ["creditsUsed", "credits_used", "usedCredits"]);
  const creditsLimit = readFirstNumber(raw, ["creditsLimit", "credits_limit", "totalCredits", "monthlyCredits"]);
  const bonusCredits = readFirstNumber(raw, ["bonusCredits", "bonus_credits"]);
  const resetAt = readFirstDate(raw, ["resetAt", "reset_at", "renewAt", "renew_at"]);
  const quotas = [];

  if (monthlyUsed !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "kiro-monthly",
        label: "Monthly Credits",
        used: monthlyUsed,
        total: 100,
        unit: "%",
        resetAt,
      }),
    );
  }
  if (creditsUsed !== undefined || creditsLimit !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "kiro-credit-count",
        label: "Credit Count",
        used: creditsUsed,
        total: creditsLimit,
        unit: "credits",
        resetAt,
      }),
    );
  }
  if (bonusCredits !== undefined) {
    quotas.push(
      buildCountQuota({ id: "kiro-bonus-credits", label: "Bonus Credits", remaining: bonusCredits, unit: "credits" }),
    );
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "kiro-cli-output",
      label: "CLI Usage",
      remainingDisplay:
        text.trim().slice(0, 180) || "Kiro CLI returned output, but no known usage fields were present.",
      status: "unknown" as const,
    });
  }
  return quotas;
}

export async function fetchKiroSnapshot(cliPath?: string) {
  const binary = cliPath?.trim() || process.env.KIRO_CLI_PATH?.trim() || "kiro-cli";
  const text = await runCommandText(binary, ["chat", "--no-interactive", "/usage"], 12000);
  const parsed = parseJsonObjectFromText(text);
  const plan = readFirstString(parsed, ["plan", "planName", "subscription"]) ?? "CLI";

  return buildSnapshot({
    provider: "kiro",
    planLabel: plan,
    quotas: mapKiroUsage(parsed, text),
    endpoint: `${binary} chat --no-interactive /usage`,
    sourceLabel: "Kiro CLI",
    rawPayload: parsed ?? { output: text },
    resetPolicy: "Kiro usage is parsed from the Kiro CLI usage command.",
  });
}
