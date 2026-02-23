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
