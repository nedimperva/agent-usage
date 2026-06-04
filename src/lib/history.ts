import { QuotaHistorySeries, ProviderUsageSnapshot, QuotaSampleSource } from "../models/usage";

const MAX_POINTS_PER_QUOTA = 120;
const SPARK_CHARS = "._-:=+*#%@";
const ROLLOVER_PERCENT_JUMP = 20;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function mergeQuotaHistory(
  previous: ProviderUsageSnapshot | undefined,
  next: ProviderUsageSnapshot,
  observedAt: string,
  sampleSource: QuotaSampleSource = "manual",
): QuotaHistorySeries[] {
  const existing = new Map<string, QuotaHistorySeries>();
  for (const series of previous?.quotaHistory ?? []) {
    existing.set(series.quotaId, {
      quotaId: series.quotaId,
      points: [...series.points],
    });
  }

  for (const quota of next.quotas) {
    if (quota.remainingPercent === undefined || !Number.isFinite(quota.remainingPercent)) {
      continue;
    }

    const normalized = clampPercent(quota.remainingPercent);
    const series = existing.get(quota.id) ?? { quotaId: quota.id, points: [] };
    const last = series.points[series.points.length - 1];
    const lastResetAt = last?.resetAt;
    const currentResetAt = quota.resetAt;
    const observedAtMs = Date.parse(observedAt);
    const lastAtMs = last ? Date.parse(last.at) : NaN;
    const lastResetAtMs = lastResetAt ? Date.parse(lastResetAt) : NaN;
    const resetChanged = !!lastResetAt && !!currentResetAt && lastResetAt !== currentResetAt;
    const resetPassed =
      !Number.isNaN(lastResetAtMs) &&
      !Number.isNaN(observedAtMs) &&
      !Number.isNaN(lastAtMs) &&
      lastAtMs <= lastResetAtMs &&
      observedAtMs > lastResetAtMs;
    const remainingJumped = !!last && normalized >= last.remainingPercent + ROLLOVER_PERCENT_JUMP;

    if (resetChanged || resetPassed || remainingJumped) {
      series.points = [];
    }

    if (
      !last ||
      resetChanged ||
      resetPassed ||
      remainingJumped ||
      Math.abs(last.remainingPercent - normalized) > 0.01
    ) {
      series.points.push({ at: observedAt, remainingPercent: normalized, resetAt: currentResetAt, sampleSource });
    } else {
      series.points[series.points.length - 1] = {
        at: observedAt,
        remainingPercent: normalized,
        resetAt: currentResetAt,
        sampleSource,
      };
    }

    if (series.points.length > MAX_POINTS_PER_QUOTA) {
      series.points = series.points.slice(series.points.length - MAX_POINTS_PER_QUOTA);
    }
    existing.set(quota.id, series);
  }

  return Array.from(existing.values());
}

function nearestPointAtOrBefore(points: QuotaHistorySeries["points"], cutoffMs: number) {
  let selected: QuotaHistorySeries["points"][number] | undefined;
  for (const point of points) {
    const atMs = Date.parse(point.at);
    if (Number.isNaN(atMs)) {
      continue;
    }
    if (atMs <= cutoffMs) {
      selected = point;
    }
  }
  return selected;
}

export interface HistorySummary {
  sparkline: string;
  delta24h?: number;
  delta7d?: number;
}

export function summarizeQuotaHistory(series: QuotaHistorySeries, now = new Date()): HistorySummary {
  const points = series.points;
  if (points.length === 0) {
    return { sparkline: "" };
  }

  const values = points.map((point) => clampPercent(point.remainingPercent));
  const sparkline = values
    .slice(-24)
    .map((value) => {
      const idx = Math.round((value / 100) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
    })
    .join("");

  const latest = points[points.length - 1];
  const nowMs = now.getTime();
  const point24h = nearestPointAtOrBefore(points, nowMs - 24 * 60 * 60 * 1000);
  const point7d = nearestPointAtOrBefore(points, nowMs - 7 * 24 * 60 * 60 * 1000);

  return {
    sparkline,
    delta24h: point24h ? latest.remainingPercent - point24h.remainingPercent : undefined,
    delta7d: point7d ? latest.remainingPercent - point7d.remainingPercent : undefined,
  };
}
