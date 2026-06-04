import { ProviderUsageSnapshot } from "../models/usage";
import { fetchOpenCodeSnapshot } from "./opencode";

export async function fetchOpenCodeGoSnapshot(
  input?: Parameters<typeof fetchOpenCodeSnapshot>[0],
  workspaceIdPreference?: string,
): Promise<ProviderUsageSnapshot> {
  const base = await fetchOpenCodeSnapshot(input, workspaceIdPreference);
  return {
    ...base,
    provider: "opencode-go",
    planLabel: base.planLabel ? `Go ${base.planLabel}` : "Go",
    quotas: [
      ...base.quotas.map((quota) => ({
        ...quota,
        id: quota.id.replace(/^opencode/, "opencode-go"),
      })),
      ...((base.rawPayload as { usage?: { monthlyUsedPercent?: number; monthlyResetInSec?: number } })?.usage
        ?.monthlyUsedPercent !== undefined
        ? [
            {
              id: "opencode-go-monthly",
              label: "Monthly Limit",
              remainingPercent: Math.max(
                0,
                Math.min(
                  100,
                  100 -
                    ((base.rawPayload as { usage?: { monthlyUsedPercent?: number } }).usage?.monthlyUsedPercent ?? 0),
                ),
              ),
              remainingDisplay: `${Math.max(
                0,
                Math.min(
                  100,
                  100 -
                    ((base.rawPayload as { usage?: { monthlyUsedPercent?: number } }).usage?.monthlyUsedPercent ?? 0),
                ),
              ).toFixed(0)}% left`,
              resetAt:
                (base.rawPayload as { usage?: { monthlyResetInSec?: number } }).usage?.monthlyResetInSec !== undefined
                  ? new Date(
                      Date.now() +
                        ((base.rawPayload as { usage?: { monthlyResetInSec?: number } }).usage?.monthlyResetInSec ??
                          0) *
                          1000,
                    ).toISOString()
                  : undefined,
              status: base.quotas[0]?.status ?? "unknown",
            },
          ]
        : []),
    ],
    metadataSections: [
      ...(base.metadataSections ?? []),
      {
        id: "opencode-go-mode",
        title: "OpenCode Go",
        items: [{ label: "Source", value: "OpenCode workspace Go usage mode" }],
      },
    ],
    resetPolicy: "OpenCode Go uses the workspace rolling, weekly, and optional monthly usage windows.",
  };
}
