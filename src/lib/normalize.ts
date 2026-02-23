import { QuotaStatus } from "../models/usage";

const CRITICAL_THRESHOLD = 10;
const WARNING_THRESHOLD = 25;

export function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return value;
}

export function toRemainingPercent(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return clampPercent(parsed);
}

export function statusFromRemainingPercent(remainingPercent?: number): QuotaStatus {
  if (remainingPercent === undefined) {
    return "unknown";
  }

  if (remainingPercent < CRITICAL_THRESHOLD) {
    return "critical";
  }

  if (remainingPercent <= WARNING_THRESHOLD) {
    return "warning";
  }

  return "ok";
}

export function formatPercent(value?: number): string {
  if (value === undefined) {
    return "n/a";
  }

  const rounded = Math.round(value * 10) / 10;
  const display = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
  return `${display}%`;
}

export function parseDateLike(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isNaN(parsedMs)) {
    return new Date(parsedMs).toISOString();
  }

  return undefined;
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function safeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
