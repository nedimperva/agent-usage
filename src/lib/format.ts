import { Color, Icon, List } from "@raycast/api";
import { formatResetDate } from "./date";
import { QuotaItem, QuotaStatus } from "../models/usage";

function statusColor(status: QuotaStatus): Color {
  switch (status) {
    case "ok":
      return Color.Green;
    case "warning":
      return Color.Yellow;
    case "critical":
      return Color.Red;
    case "unknown":
    default:
      return Color.SecondaryText;
  }
}

export function statusIcon(status: QuotaStatus): NonNullable<List.Item.Props["icon"]> {
  return {
    source: Icon.Circle,
    tintColor: statusColor(status),
  };
}

function statusHex(status: QuotaStatus): string {
  switch (status) {
    case "ok":
      return "#1FA971";
    case "warning":
      return "#D79A1D";
    case "critical":
      return "#C86A72";
    case "unknown":
    default:
      return "#8D94A1";
  }
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDegrees: number): { x: number; y: number } {
  const angleRadians = (angleDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians),
  };
}

function arcPath(cx: number, cy: number, radius: number, percent: number): string | undefined {
  if (percent <= 0) {
    return undefined;
  }

  if (percent >= 100) {
    return undefined;
  }

  const startAngle = -90;
  const endAngle = startAngle + (percent / 100) * 360;
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = percent > 50 ? 1 : 0;

  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

export function quotaProgressIcon(quota: QuotaItem): NonNullable<List.Item.Props["icon"]> {
  if (quota.remainingPercent === undefined || !Number.isFinite(quota.remainingPercent)) {
    return statusIcon(quota.status);
  }

  const remainingPercent = Math.max(0, Math.min(100, quota.remainingPercent));
  const visiblePercent = remainingPercent > 0 ? Math.max(remainingPercent, 3) : 0;
  const size = 16;
  const center = 8;
  const radius = 6;
  const strokeWidth = 2;
  const path = arcPath(center, center, radius, visiblePercent);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#9AA3B21A" stroke-width="${strokeWidth}" />
  ${
    path
      ? `<path d="${path}" fill="none" stroke="${statusHex(quota.status)}" stroke-width="${strokeWidth}" stroke-linecap="round" />`
      : visiblePercent >= 100
        ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${statusHex(quota.status)}" stroke-width="${strokeWidth}" />`
        : ""
  }
</svg>`.trim();

  return {
    source: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
  };
}

export function quotaAccessories(quota: QuotaItem): NonNullable<List.Item.Props["accessories"]> {
  const accessories: NonNullable<List.Item.Props["accessories"]> = [];

  if (quota.trendBadge) {
    accessories.push({
      tag: {
        value: quota.trendBadge,
        color: Color.Orange,
      },
    });
  }

  const reset = formatResetDate(quota.resetAt);
  if (reset) {
    accessories.push({ text: reset });
  }

  return accessories;
}
