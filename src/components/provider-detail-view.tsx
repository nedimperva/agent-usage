import { Icon, List } from "@raycast/api";
import { ReactElement } from "react";
import { formatRelativeTimestamp } from "../lib/date";
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
  const summary = summarizeProviderSnapshot(snapshot);

  return (
    <List isLoading={isRefreshing} searchBarPlaceholder={`Search ${summary.title} quotas...`}>
      <List.Section title="Status" subtitle={`Updated ${formatRelativeTimestamp(snapshot.fetchedAt)}`}>
        <List.Item
          icon={statusIcon(summary.status)}
          title={summary.title}
          subtitle={summary.subtitle}
          actions={renderActions(snapshot)}
        />
      </List.Section>
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
