import { Icon, List } from "@raycast/api";
import { ReactElement } from "react";
import { summarizeQuotaHistory } from "../lib/history";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "../lib/date";
import { summarizeProviderSnapshot } from "../lib/dashboard";
import { quotaAccessories, quotaProgressIcon, statusIcon } from "../lib/format";
import { ProviderUsageSnapshot } from "../models/usage";

export interface PendingCopilotDeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  createdAt: string;
}

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
  const hiddenMetadataSectionIds = new Set([
    "account",
    "auth",
    "source",
    "credits",
    "web-extras",
    "cost",
    "local-cost",
  ]);
  const summary = summarizeProviderSnapshot(snapshot);
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
  const historyByQuotaId = new Map((snapshot.quotaHistory ?? []).map((series) => [series.quotaId, series]));
  const visibleMetadataSections = (snapshot.metadataSections ?? []).filter(
    (section) => !hiddenMetadataSectionIds.has(section.id),
  );
  const usageModeSection = visibleMetadataSections.find(
    (section) => section.id === "usage-mode" || section.id === "model-behavior",
  );
  const metadataSectionsAfterTop = visibleMetadataSections.filter((section) => section.id !== usageModeSection?.id);
  const rawPayloadSummary = (() => {
    const raw = snapshot.rawPayload;
    if (raw === undefined) {
      return undefined;
    }
    if (raw === null) {
      return "null";
    }
    if (Array.isArray(raw)) {
      return `Array (${raw.length} items)`;
    }
    if (typeof raw === "object") {
      return `Object (${Object.keys(raw as Record<string, unknown>).length} keys)`;
    }
    return typeof raw;
  })();

  return (
    <List isLoading={isRefreshing} searchBarPlaceholder={`Search ${summary.title} quotas...`}>
      <List.Section title="Status" subtitle={`Updated ${formatRelativeTimestamp(snapshot.fetchedAt)}`}>
        <List.Item
          icon={statusIcon(summary.status)}
          title={summary.title}
          subtitle={`${summary.subtitle}${staleStatus ? ` Data freshness: ${staleStatus}.` : ""}`}
          actions={renderActions(snapshot)}
        />
      </List.Section>

      {usageModeSection && (
        <List.Section key={usageModeSection.id} title={usageModeSection.title}>
          {usageModeSection.items.map((item, index) => (
            <List.Item
              key={`${usageModeSection.id}-${index}`}
              icon={Icon.Dot}
              title={item.label}
              subtitle={item.value}
              accessories={item.subtitle ? [{ text: item.subtitle }] : undefined}
              actions={renderActions(snapshot)}
            />
          ))}
        </List.Section>
      )}

      <List.Section title="Quotas" subtitle={`${snapshot.quotas.length} tracked`}>
        {snapshot.quotas.map((quota) => (
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

      {snapshot.quotas.length > 0 && (
        <List.Section title="History">
          {snapshot.quotas.map((quota) => {
            const history = historyByQuotaId.get(quota.id);
            const summaryHistory = history ? summarizeQuotaHistory(history) : undefined;
            const latestPoint = history?.points[history.points.length - 1];
            const latestObserved = formatAbsoluteTimestamp(latestPoint?.at);
            const deltaParts = [
              summaryHistory?.delta24h !== undefined
                ? `24h ${summaryHistory.delta24h > 0 ? "+" : ""}${summaryHistory.delta24h.toFixed(1)}%`
                : undefined,
              summaryHistory?.delta7d !== undefined
                ? `7d ${summaryHistory.delta7d > 0 ? "+" : ""}${summaryHistory.delta7d.toFixed(1)}%`
                : undefined,
              latestObserved ? `Last ${latestObserved}` : undefined,
            ]
              .filter((part): part is string => !!part)
              .join(" | ");

            return (
              <List.Item
                key={`${snapshot.provider}-history-${quota.id}`}
                icon={Icon.LineChart}
                title={quota.label}
                subtitle={summaryHistory?.sparkline || "No trend data yet"}
                accessories={deltaParts ? [{ text: deltaParts }] : undefined}
                actions={renderActions(snapshot)}
              />
            );
          })}
        </List.Section>
      )}

      {metadataSectionsAfterTop.map((section) => (
        <List.Section key={section.id} title={section.title}>
          {section.items.map((item, index) => (
            <List.Item
              key={`${section.id}-${index}`}
              icon={Icon.Dot}
              title={item.label}
              subtitle={item.value}
              accessories={item.subtitle ? [{ text: item.subtitle }] : undefined}
              actions={renderActions(snapshot)}
            />
          ))}
        </List.Section>
      ))}

      {snapshot.resetPolicy && (
        <List.Section title="Reset Policy">
          <List.Item
            icon={Icon.ArrowClockwise}
            title="Policy"
            subtitle={snapshot.resetPolicy}
            actions={renderActions(snapshot)}
          />
        </List.Section>
      )}

      {rawPayloadSummary && (
        <List.Section title="Raw Payload">
          <List.Item
            icon={Icon.Document}
            title="Payload Captured"
            subtitle={`${rawPayloadSummary}. Use "Copy ... Debug Bundle" to export a redacted payload.`}
            actions={renderActions(snapshot)}
          />
        </List.Section>
      )}

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
