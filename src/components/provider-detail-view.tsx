import { Icon, List } from "@raycast/api";
import { ReactElement } from "react";
import { formatRelativeTimestamp } from "../lib/date";
import { summarizeProviderSnapshot } from "../lib/dashboard";
import {
  formatForecastConfidenceLabel,
  formatForecastPaceLabel,
  formatForecastRunoutLabel,
  formatForecastSampleAge,
  formatProjectedRemainingLabel,
} from "../lib/forecast";
import { quotaAccessories, quotaProgressIcon, statusIcon } from "../lib/format";
import { summarizeQuotaHistory } from "../lib/history";
import { PendingCopilotDeviceLogin } from "../models/copilot";
import { ProviderUsageSnapshot } from "../models/usage";

interface ProviderDetailViewProps {
  snapshot: ProviderUsageSnapshot;
  issues: string[];
  isRefreshing: boolean;
  pendingCopilotLogin?: PendingCopilotDeviceLogin;
  pendingCopilotExpiresAt?: string;
  renderActions: (snapshot: ProviderUsageSnapshot) => ReactElement;
}

export function ProviderDetailView({
  snapshot,
  issues,
  isRefreshing,
  pendingCopilotLogin,
  pendingCopilotExpiresAt,
  renderActions,
}: ProviderDetailViewProps) {
  const summary = summarizeProviderSnapshot(snapshot);
  const historyMap = new Map((snapshot.quotaHistory ?? []).map((series) => [series.quotaId, series]));
  const sortedQuotas = [...snapshot.quotas].sort((a, b) => {
    const aForecast = a.forecast ? 1 : 0;
    const bForecast = b.forecast ? 1 : 0;
    if (aForecast !== bForecast) {
      return bForecast - aForecast;
    }
    return a.label.localeCompare(b.label);
  });
  const staleStatus =
    snapshot.staleAfterSeconds !== undefined
      ? (() => {
          const fetchedAtMs = Date.parse(snapshot.fetchedAt);
          if (Number.isNaN(fetchedAtMs)) {
            return "unknown";
          }
          const stale = Date.now() - fetchedAtMs > snapshot.staleAfterSeconds * 1000;
          return stale ? "Stale" : "Fresh";
        })()
      : undefined;
  const usageModeSection = (snapshot.metadataSections ?? []).find(
    (section) => section.id === "usage-mode" || section.id === "model-behavior",
  );
  const usageModeHighlights = (usageModeSection?.items ?? []).map((item) => {
    if (!item.subtitle) {
      return `${item.label}: ${item.value}`;
    }

    return `${item.label}: ${item.value} (${item.subtitle})`;
  });
  const detailHighlights = [...(snapshot.highlights ?? []), ...usageModeHighlights]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const uniqueHighlights = Array.from(new Set(detailHighlights)).slice(0, 4);
  const statusSubtitle = [
    snapshot.quotas.length === 1 ? "1 quota tracked" : `${snapshot.quotas.length} quotas tracked`,
    staleStatus ? `Freshness: ${staleStatus}` : undefined,
  ]
    .filter((part): part is string => !!part)
    .join(" | ");

  return (
    <List isLoading={isRefreshing} searchBarPlaceholder={`Search ${summary.title} quotas...`}>
      <List.Section title="Status" subtitle={`Updated ${formatRelativeTimestamp(snapshot.fetchedAt)}`}>
        <List.Item
          icon={statusIcon(summary.status)}
          title={summary.title}
          subtitle={statusSubtitle}
          actions={renderActions(snapshot)}
        />
      </List.Section>

      {uniqueHighlights.length > 0 && (
        <List.Section title="Highlights" subtitle={`${uniqueHighlights.length} key details`}>
          {uniqueHighlights.map((highlight, index) => (
            <List.Item
              key={`${snapshot.provider}-highlight-${index}`}
              icon={Icon.Dot}
              title={highlight}
              actions={renderActions(snapshot)}
            />
          ))}
        </List.Section>
      )}

      <List.Section title="Quotas" subtitle={`${snapshot.quotas.length} tracked`}>
        {sortedQuotas.map((quota) => (
          <List.Item
            key={`${snapshot.provider}-${quota.id}`}
            icon={quotaProgressIcon(quota)}
            title={quota.label}
            subtitle={quota.remainingDisplay}
            accessories={quotaAccessories(quota)}
            actions={renderActions(snapshot)}
          />
        ))}
      </List.Section>

      <List.Section title="Forecasts" subtitle="Based on recent observed burn">
        {sortedQuotas.map((quota) => {
          const pace = formatForecastPaceLabel(quota.forecast);
          const runout = formatForecastRunoutLabel(quota.forecast);
          const projected = formatProjectedRemainingLabel(quota.forecast);
          const confidence = formatForecastConfidenceLabel(quota.forecast?.confidence);
          const sampleAge = formatForecastSampleAge(quota.forecast);
          const subtitle = [
            quota.remainingDisplay,
            pace,
            runout,
            projected,
            confidence,
            sampleAge,
            quota.forecast?.hiddenReason,
          ]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join(" | ");

          return (
            <List.Item
              key={`${snapshot.provider}-${quota.id}-forecast`}
              icon={quotaProgressIcon(quota)}
              title={quota.label}
              subtitle={subtitle || "Estimate unavailable"}
              accessories={quotaAccessories(quota)}
              actions={renderActions(snapshot)}
            />
          );
        })}
      </List.Section>

      <List.Section title="History" subtitle="Sparkline and recent deltas">
        {sortedQuotas.map((quota) => {
          const history = historyMap.get(quota.id);
          const summary = history ? summarizeQuotaHistory(history) : { sparkline: "" };
          const delta24h =
            summary.delta24h !== undefined
              ? `24h ${summary.delta24h >= 0 ? "+" : ""}${summary.delta24h.toFixed(1).replace(/\.0$/, "")}%`
              : "";
          const delta7d =
            summary.delta7d !== undefined
              ? `7d ${summary.delta7d >= 0 ? "+" : ""}${summary.delta7d.toFixed(1).replace(/\.0$/, "")}%`
              : "";
          const subtitle = [summary.sparkline || "No trend yet", delta24h, delta7d]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join(" | ");

          return (
            <List.Item
              key={`${snapshot.provider}-${quota.id}-history`}
              icon={Icon.LineChart}
              title={quota.label}
              subtitle={subtitle}
              actions={renderActions(snapshot)}
            />
          );
        })}
      </List.Section>

      {issues.length > 0 && (
        <List.Section title="Issues" subtitle={`${issues.length} active`}>
          {issues.map((issue, index) => (
            <List.Item
              key={`${snapshot.provider}-issue-${index}`}
              icon={statusIcon("warning")}
              title={`Issue ${index + 1}`}
              subtitle={issue}
              actions={renderActions(snapshot)}
            />
          ))}
        </List.Section>
      )}

      {snapshot.provider === "copilot" && pendingCopilotLogin && (
        <List.Section title="Copilot Device Login">
          <List.Item
            icon={Icon.Key}
            title={`Device Code: ${pendingCopilotLogin.userCode}`}
            subtitle={
              pendingCopilotExpiresAt
                ? `Expires ${formatRelativeTimestamp(pendingCopilotExpiresAt)}. Paste this code on GitHub device page.`
                : "Code expired. Start Copilot Device Login again."
            }
            accessories={[{ text: pendingCopilotExpiresAt ? "Pending" : "Expired" }]}
            actions={renderActions(snapshot)}
          />
        </List.Section>
      )}
    </List>
  );
}
