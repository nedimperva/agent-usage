import { ProviderId, ProviderUsageSnapshot } from "../models/usage";
import { formatRelativeTimestamp, formatRemainingDaysHours } from "./date";
import { formatPercent } from "./normalize";

export type AlertSeverity = "warning" | "critical";

export interface AlertItem {
  id: string;
  provider: ProviderId;
  quotaId?: string;
  label: string;
  remainingPercent?: number;
  resetAt?: string;
  fetchedAt: string;
  severity: AlertSeverity;
  message: string;
  recommendedAction: string;
}

export interface AlertSummary {
  critical: number;
  warning: number;
  total: number;
}

const WARNING_THRESHOLD = 25;
const CRITICAL_THRESHOLD = 10;
const PROVIDER_ORDER: ProviderId[] = ["codex", "copilot", "claude"];

export function providerTitle(provider: ProviderId): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "copilot":
    default:
      return "GitHub Copilot";
  }
}

export function providerRecoveryHint(provider: ProviderId): string {
  switch (provider) {
    case "codex":
      return "Run `codex login`, then refresh.";
    case "claude":
      return "Run `claude login`, then refresh.";
    case "copilot":
    default:
      return "Start Copilot Device Login and complete device verification.";
  }
}

function isUnavailableFallback(snapshot: ProviderUsageSnapshot): boolean {
  return snapshot.source === "manual" && snapshot.quotas.some((quota) => quota.label === "Unavailable");
}

function alertSeverity(remainingPercent: number): AlertSeverity | undefined {
  if (remainingPercent <= CRITICAL_THRESHOLD) {
    return "critical";
  }

  if (remainingPercent <= WARNING_THRESHOLD) {
    return "warning";
  }

  return undefined;
}

export function deriveSnapshotAlerts(snapshots: ProviderUsageSnapshot[], now = new Date()): AlertItem[] {
  const nowMs = now.getTime();
  const alerts: AlertItem[] = [];

  for (const snapshot of snapshots) {
    if (isUnavailableFallback(snapshot)) {
      const unavailableQuota = snapshot.quotas.find((quota) => quota.label === "Unavailable");
      alerts.push({
        id: `${snapshot.provider}-unavailable`,
        provider: snapshot.provider,
        label: "Usage Unavailable",
        fetchedAt: snapshot.fetchedAt,
        severity: "warning",
        message: `${unavailableQuota?.remainingDisplay ?? `${providerTitle(snapshot.provider)} usage data is unavailable.`} Updated ${formatRelativeTimestamp(snapshot.fetchedAt, nowMs)}.`,
        recommendedAction: providerRecoveryHint(snapshot.provider),
      });
      continue;
    }

    for (const quota of snapshot.quotas) {
      if (quota.remainingPercent === undefined || !Number.isFinite(quota.remainingPercent)) {
        continue;
      }

      const remainingPercent = Math.max(0, Math.min(100, quota.remainingPercent));
      const severity = alertSeverity(remainingPercent);
      if (!severity) {
        continue;
      }

      const resetCountdown = formatRemainingDaysHours(quota.resetAt, nowMs);
      alerts.push({
        id: `${snapshot.provider}-${quota.id}-threshold`,
        provider: snapshot.provider,
        quotaId: quota.id,
        label: quota.label,
        remainingPercent,
        resetAt: quota.resetAt,
        fetchedAt: snapshot.fetchedAt,
        severity,
        message: [
          severity === "critical"
            ? `Critical threshold reached (${formatPercent(remainingPercent)} left; threshold <=10%).`
            : `Warning threshold reached (${formatPercent(remainingPercent)} left; threshold <=25%).`,
          resetCountdown ? `Resets in ${resetCountdown}.` : undefined,
          `Updated ${formatRelativeTimestamp(snapshot.fetchedAt, nowMs)}.`,
        ]
          .filter((part): part is string => !!part)
          .join(" "),
        recommendedAction: `Open ${providerTitle(snapshot.provider)} usage, then refresh.`,
      });
    }
  }

  return alerts.sort((left, right) => {
    const severityRank = left.severity === right.severity ? 0 : left.severity === "critical" ? -1 : 1;
    if (severityRank !== 0) {
      return severityRank;
    }

    const providerRank = PROVIDER_ORDER.indexOf(left.provider) - PROVIDER_ORDER.indexOf(right.provider);
    if (providerRank !== 0) {
      return providerRank;
    }

    const leftRemaining = left.remainingPercent ?? 101;
    const rightRemaining = right.remainingPercent ?? 101;
    return leftRemaining - rightRemaining;
  });
}

export function summarizeAlerts(alerts: AlertItem[]): AlertSummary {
  const summary: AlertSummary = {
    critical: 0,
    warning: 0,
    total: alerts.length,
  };

  for (const alert of alerts) {
    if (alert.severity === "critical") {
      summary.critical += 1;
      continue;
    }
    summary.warning += 1;
  }

  return summary;
}
