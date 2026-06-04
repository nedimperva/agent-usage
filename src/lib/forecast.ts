import {
  ProviderUsageSnapshot,
  QuotaForecast,
  QuotaForecastConfidence,
  QuotaHistorySeries,
  QuotaItem,
} from "../models/usage";
import { formatRemainingDaysHours, formatRelativeTimestamp } from "./date";

const PACE_TOLERANCE_PERCENT = 4;
const MIN_RUNOUT_SPAN_HOURS = 1;
const MIN_MEANINGFUL_BURN_RATE = 0.1;
const DEFAULT_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseIsoMs(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveWindowStartAt(quota: QuotaItem): string | undefined {
  const explicitStartMs = parseIsoMs(quota.windowStartAt);
  if (explicitStartMs !== undefined) {
    return new Date(explicitStartMs).toISOString();
  }

  const resetAtMs = parseIsoMs(quota.resetAt);
  if (resetAtMs === undefined || quota.windowDurationSeconds === undefined || quota.windowDurationSeconds <= 0) {
    return undefined;
  }

  return new Date(resetAtMs - quota.windowDurationSeconds * 1000).toISOString();
}

function detectConfidence(
  sampleCount: number,
  spanHours: number,
  hasBackgroundSample: boolean,
): QuotaForecastConfidence | undefined {
  if (hasBackgroundSample && sampleCount >= 6 && spanHours >= 12) {
    return "high";
  }

  if (sampleCount >= 3 && spanHours >= 4) {
    return "medium";
  }

  if (sampleCount >= 2 && spanHours >= 1) {
    return "low";
  }

  return undefined;
}

function derivePaceStatus(quota: QuotaItem, nowMs: number): Partial<QuotaForecast> {
  const remainingPercent = quota.remainingPercent;
  const resetAtMs = parseIsoMs(quota.resetAt);
  const windowStartAt = resolveWindowStartAt(quota);
  const windowStartMs = parseIsoMs(windowStartAt);

  if (
    remainingPercent === undefined ||
    !Number.isFinite(remainingPercent) ||
    resetAtMs === undefined ||
    windowStartMs === undefined ||
    resetAtMs <= windowStartMs
  ) {
    return {
      paceStatus: "unknown",
    };
  }

  const totalWindowMs = resetAtMs - windowStartMs;
  const remainingWindowMs = Math.max(0, resetAtMs - nowMs);
  const idealRemainingPercent = clampPercent((remainingWindowMs / totalWindowMs) * 100);
  const delta = remainingPercent - idealRemainingPercent;

  if (delta <= -PACE_TOLERANCE_PERCENT) {
    return {
      paceStatus: "deficit",
      deficitPercent: Math.abs(delta),
    };
  }

  if (delta >= PACE_TOLERANCE_PERCENT) {
    return {
      paceStatus: "surplus",
      surplusPercent: delta,
    };
  }

  return {
    paceStatus: "on-pace",
  };
}

export function deriveQuotaForecast(
  quota: QuotaItem,
  series: QuotaHistorySeries | undefined,
  snapshot: Pick<ProviderUsageSnapshot, "staleAfterSeconds">,
  now = new Date(),
): QuotaForecast | undefined {
  const points =
    series?.points.filter(
      (point) =>
        Number.isFinite(point.remainingPercent) && (quota.resetAt === undefined || point.resetAt === quota.resetAt),
    ) ?? [];

  if (points.length === 0) {
    return undefined;
  }

  const sorted = [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = sorted[sorted.length - 1];
  const latestAtMs = parseIsoMs(latest.at);
  if (latestAtMs === undefined) {
    return undefined;
  }

  const nowMs = now.getTime();
  const staleThresholdMs = Math.max((snapshot.staleAfterSeconds ?? 0) * 1000, DEFAULT_STALE_THRESHOLD_MS);
  const paceData = derivePaceStatus(quota, nowMs);
  const baseForecast: QuotaForecast = {
    paceStatus: paceData.paceStatus ?? "unknown",
    deficitPercent: paceData.deficitPercent,
    surplusPercent: paceData.surplusPercent,
    sampleCount: sorted.length,
    lastSampleAt: latest.at,
  };

  if (nowMs - latestAtMs > staleThresholdMs) {
    return {
      ...baseForecast,
      hiddenReason: "Recent samples are stale.",
    };
  }

  if (sorted.length < 2 || quota.remainingPercent === undefined || !Number.isFinite(quota.remainingPercent)) {
    return {
      ...baseForecast,
      hiddenReason: "Need at least 2 same-cycle samples for a runout estimate.",
    };
  }

  const first = sorted[0];
  const firstAtMs = parseIsoMs(first.at);
  if (firstAtMs === undefined) {
    return {
      ...baseForecast,
      hiddenReason: "Sample timestamps are invalid.",
    };
  }

  const spanHours = (latestAtMs - firstAtMs) / (1000 * 60 * 60);
  if (spanHours < MIN_RUNOUT_SPAN_HOURS) {
    return {
      ...baseForecast,
      hiddenReason: "Need more time between samples for a stable runout estimate.",
    };
  }

  const burnRatePerHour = (first.remainingPercent - latest.remainingPercent) / spanHours;
  if (!Number.isFinite(burnRatePerHour) || burnRatePerHour <= MIN_MEANINGFUL_BURN_RATE) {
    return {
      ...baseForecast,
      hiddenReason: "Recent burn is too low or reversed for a reliable runout estimate.",
    };
  }

  const estimatedRunoutAt = new Date(nowMs + (quota.remainingPercent / burnRatePerHour) * 60 * 60 * 1000).toISOString();
  const resetAtMs = parseIsoMs(quota.resetAt);
  const projectedRemainingAtReset =
    resetAtMs !== undefined
      ? quota.remainingPercent - burnRatePerHour * ((resetAtMs - nowMs) / (1000 * 60 * 60))
      : undefined;
  const confidence = detectConfidence(
    sorted.length,
    spanHours,
    sorted.some((point) => point.sampleSource === "background"),
  );

  return {
    ...baseForecast,
    confidence,
    estimatedRunoutAt,
    projectedRemainingAtReset,
  };
}

export function attachForecasts(snapshot: ProviderUsageSnapshot, now = new Date()): ProviderUsageSnapshot {
  const historyMap = new Map(snapshot.quotaHistory?.map((series) => [series.quotaId, series]) ?? []);
  return {
    ...snapshot,
    quotas: snapshot.quotas.map((quota) => ({
      ...quota,
      forecast: deriveQuotaForecast(quota, historyMap.get(quota.id), snapshot, now),
    })),
  };
}

export function formatForecastConfidenceLabel(confidence?: QuotaForecastConfidence): string {
  if (confidence === "high") {
    return "High confidence";
  }
  if (confidence === "medium") {
    return "Medium confidence";
  }
  if (confidence === "low") {
    return "Low confidence";
  }
  return "";
}

export function formatForecastPaceLabel(forecast?: QuotaForecast): string {
  if (!forecast) {
    return "";
  }

  if (forecast.paceStatus === "deficit" && forecast.deficitPercent !== undefined) {
    return `${Math.round(forecast.deficitPercent)}% deficit`;
  }

  if (forecast.paceStatus === "surplus" && forecast.surplusPercent !== undefined) {
    return `${Math.round(forecast.surplusPercent)}% surplus`;
  }

  if (forecast.paceStatus === "on-pace") {
    return "On pace";
  }

  return "";
}

export function formatForecastRunoutLabel(forecast?: QuotaForecast, now = new Date()): string {
  if (!forecast?.estimatedRunoutAt) {
    return "";
  }

  return `Runs out in ${formatRemainingDaysHours(forecast.estimatedRunoutAt, now.getTime())}`;
}

export function formatProjectedRemainingLabel(forecast?: QuotaForecast): string {
  if (
    !forecast ||
    forecast.projectedRemainingAtReset === undefined ||
    !Number.isFinite(forecast.projectedRemainingAtReset)
  ) {
    return "";
  }

  const projected = Math.round(forecast.projectedRemainingAtReset * 10) / 10;
  if (projected >= 0) {
    return `Ends near ${projected.toFixed(1).replace(/\.0$/, "")}%`;
  }

  return `${Math.abs(projected).toFixed(1).replace(/\.0$/, "")}% short by reset`;
}

function forecastPriority(quota: QuotaItem): number {
  const forecast = quota.forecast;
  if (!forecast) {
    return 0;
  }
  if (forecast.paceStatus === "deficit" || forecast.estimatedRunoutAt) {
    return 4;
  }
  if (forecast.paceStatus === "surplus") {
    return 3;
  }
  if (forecast.paceStatus === "on-pace") {
    return 2;
  }
  return 1;
}

export function primaryForecastQuota(snapshot: ProviderUsageSnapshot): QuotaItem | undefined {
  return [...snapshot.quotas]
    .filter((quota) => quota.forecast)
    .sort((a, b) => forecastPriority(b) - forecastPriority(a))[0];
}

export function formatCompactForecastHint(snapshot: ProviderUsageSnapshot, now = new Date()): string | undefined {
  const quota = primaryForecastQuota(snapshot);
  if (!quota?.forecast) {
    return undefined;
  }

  const parts = [
    quota.label,
    formatForecastPaceLabel(quota.forecast),
    formatForecastRunoutLabel(quota.forecast, now),
    formatForecastConfidenceLabel(quota.forecast.confidence),
  ].filter((part): part is string => part.length > 0);

  return parts.length > 1 ? parts.join(" | ") : undefined;
}

export function formatForecastSampleAge(forecast?: QuotaForecast, now = new Date()): string {
  if (!forecast?.lastSampleAt) {
    return "";
  }

  return `Last sample ${formatRelativeTimestamp(forecast.lastSampleAt, now.getTime())}`;
}
