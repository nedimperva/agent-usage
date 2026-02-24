import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { parseDateLike, parseOptionalNumber, safeString, statusFromRemainingPercent } from "../lib/normalize";

const CURSOR_BASE_URL = "https://cursor.com";
const BROWSER_LIKE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface CursorUsageSummary {
  billingCycleStart?: unknown;
  billing_cycle_start?: unknown;
  billingCycleEnd?: unknown;
  billing_cycle_end?: unknown;
  membershipType?: unknown;
  membership_type?: unknown;
  limitType?: unknown;
  limit_type?: unknown;
  isUnlimited?: unknown;
  is_unlimited?: unknown;
  autoModelSelectedDisplayMessage?: unknown;
  auto_model_selected_display_message?: unknown;
  namedModelSelectedDisplayMessage?: unknown;
  named_model_selected_display_message?: unknown;
  individualUsage?: {
    plan?: CursorMoneyUsage;
    onDemand?: CursorMoneyUsage;
    on_demand?: CursorMoneyUsage;
  };
  individual_usage?: {
    plan?: CursorMoneyUsage;
    on_demand?: CursorMoneyUsage;
  };
  teamUsage?: {
    onDemand?: CursorMoneyUsage;
    on_demand?: CursorMoneyUsage;
  };
  team_usage?: {
    on_demand?: CursorMoneyUsage;
  };
}

interface CursorMoneyUsage {
  enabled?: unknown;
  used?: unknown;
  limit?: unknown;
  remaining?: unknown;
  totalPercentUsed?: unknown;
  total_percent_used?: unknown;
}

interface CursorUserInfo {
  sub?: unknown;
  email?: unknown;
}

interface CursorLegacyUsageResponse {
  "gpt-4"?: {
    numRequests?: unknown;
    numRequestsTotal?: unknown;
    maxRequestUsage?: unknown;
  };
}

function parseCookieLineFromMultilineInput(input: string): string | undefined {
  const lines = input.split(/\r?\n/);
  let collecting = false;
  const parts: string[] = [];

  for (const line of lines) {
    const cookieLine = line.match(/^\s*cookie\s*:\s*(.*)$/i);
    if (cookieLine) {
      collecting = true;
      if (cookieLine[1]) {
        parts.push(cookieLine[1].trim());
      }
      continue;
    }

    if (!collecting) {
      continue;
    }

    if (/^\s*[A-Za-z0-9-]+\s*:/.test(line)) {
      break;
    }

    const continuation = line.trim();
    if (!continuation) {
      break;
    }
    parts.push(continuation);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
}

export function normalizeCursorCookieHeader(value: string): string {
  const trimmed = value.trim();
  const fromMultiline = trimmed.includes("\n") ? parseCookieLineFromMultilineInput(trimmed) : undefined;
  const source = fromMultiline ?? trimmed;
  const withoutPrefix = source.replace(/^cookie:\s*/i, "").replace(/^['"]|['"]$/g, "");

  return withoutPrefix
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes("=") && part.length > 0)
    .join("; ");
}

function toMembershipLabel(value: unknown): string | undefined {
  const raw = safeString(value);
  if (!raw) {
    return undefined;
  }

  const normalized = raw.toLowerCase();
  if (normalized.includes("enterprise")) {
    return "Enterprise";
  }
  if (normalized.includes("team")) {
    return "Team";
  }
  if (normalized.includes("pro")) {
    return "Pro";
  }
  if (normalized.includes("hobby")) {
    return "Hobby";
  }

  return raw[0].toUpperCase() + raw.slice(1);
}

function formatDaysRemaining(targetIso?: string): string {
  if (!targetIso) {
    return "unknown";
  }
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) {
    return "unknown";
  }
  const deltaDays = Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
  if (deltaDays < 0) {
    return "expired";
  }
  return `${deltaDays} days`;
}

function toMajorUnits(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return parsed / 100;
}

function normalizeUsedPercent(value: unknown): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, percent));
}

function buildMoneyQuota(
  id: string,
  label: string,
  usage: CursorMoneyUsage | undefined,
  resetAt?: string,
): QuotaItem | undefined {
  if (!usage) {
    return undefined;
  }

  const used = toMajorUnits(usage.used);
  const limit = toMajorUnits(usage.limit);
  const remaining = toMajorUnits(usage.remaining);

  let remainingPercent: number | undefined;
  if (limit !== undefined && limit > 0 && remaining !== undefined) {
    remainingPercent = Math.max(0, Math.min(100, (remaining / limit) * 100));
  } else {
    const usedPercent = normalizeUsedPercent(usage.totalPercentUsed ?? usage.total_percent_used);
    if (usedPercent !== undefined) {
      remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
    }
  }

  let remainingDisplay = "Usage data available";
  if (remaining !== undefined && limit !== undefined) {
    remainingDisplay = `USD ${remaining.toFixed(2)} left of USD ${limit.toFixed(2)}`;
  } else if (used !== undefined && limit !== undefined && limit > 0) {
    const calcRemaining = Math.max(0, limit - used);
    remainingDisplay = `USD ${calcRemaining.toFixed(2)} left of USD ${limit.toFixed(2)}`;
  } else if (used !== undefined) {
    remainingDisplay = `USD ${used.toFixed(2)} used`;
  }

  return {
    id,
    label,
    remainingPercent,
    remainingDisplay,
    resetAt,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export function mapCursorUsageToQuotas(
  summary: CursorUsageSummary,
  legacyUsage?: CursorLegacyUsageResponse,
): QuotaItem[] {
  const quotas: QuotaItem[] = [];
  const resetAt = parseDateLike(summary.billingCycleEnd ?? summary.billing_cycle_end);
  const individualPlan = summary.individualUsage?.plan ?? summary.individual_usage?.plan;
  const individualOnDemand =
    summary.individualUsage?.onDemand ?? summary.individualUsage?.on_demand ?? summary.individual_usage?.on_demand;
  const teamOnDemandUsage =
    summary.teamUsage?.onDemand ?? summary.teamUsage?.on_demand ?? summary.team_usage?.on_demand;

  const included = buildMoneyQuota("cursor-plan", "Included Plan", individualPlan, resetAt);
  const onDemand = buildMoneyQuota("cursor-on-demand", "On-Demand Budget", individualOnDemand, resetAt);
  const teamOnDemand = buildMoneyQuota("cursor-team-on-demand", "Team On-Demand", teamOnDemandUsage, resetAt);

  if (included) {
    quotas.push(included);
  }
  if (onDemand) {
    quotas.push(onDemand);
  }
  if (teamOnDemand) {
    quotas.push(teamOnDemand);
  }

  const legacyModel = legacyUsage?.["gpt-4"];
  const maxRequests = parseOptionalNumber(legacyModel?.maxRequestUsage);
  const requestsUsed =
    parseOptionalNumber(legacyModel?.numRequestsTotal) ?? parseOptionalNumber(legacyModel?.numRequests);
  if (maxRequests !== undefined && maxRequests > 0 && requestsUsed !== undefined) {
    const remaining = Math.max(0, maxRequests - requestsUsed);
    const remainingPercent = Math.max(0, Math.min(100, (remaining / maxRequests) * 100));
    quotas.push({
      id: "cursor-legacy-requests",
      label: "Legacy Requests",
      remainingPercent,
      remainingDisplay: `${remaining.toFixed(0)} left of ${maxRequests.toFixed(0)}`,
      resetAt,
      status: statusFromRemainingPercent(remainingPercent),
    });
  }

  if (quotas.length === 0) {
    quotas.push({
      id: "cursor-empty",
      label: "Cursor Usage",
      remainingDisplay: "No usage limits found in Cursor response.",
      status: "unknown",
    });
  }

  return quotas;
}

async function requestCursorJson<T>(
  path: string,
  cookieHeader: string,
  options: { allowUnauthorized?: boolean } = {},
): Promise<T | undefined> {
  const response = await fetch(`${CURSOR_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
      Origin: "https://cursor.com",
      Referer: "https://cursor.com/dashboard",
      "User-Agent": BROWSER_LIKE_USER_AGENT,
    },
  });

  if (response.status === 401 || response.status === 403) {
    if (options.allowUnauthorized) {
      return undefined;
    }
    throw new Error("Cursor session is invalid/expired. Update Cursor Cookie Header and refresh.");
  }

  if (!response.ok) {
    if (options.allowUnauthorized) {
      return undefined;
    }
    const body = await response.text();
    throw new Error(`Cursor API ${response.status}: ${body.slice(0, 220)}`);
  }

  return (await response.json()) as T;
}

export async function fetchCursorSnapshot(cookieHeader?: string): Promise<ProviderUsageSnapshot> {
  const header = cookieHeader?.trim();
  if (!header) {
    throw new Error("No Cursor cookie header configured. Set Cursor Cookie Header in extension preferences.");
  }

  const normalizedCookie = normalizeCursorCookieHeader(header);
  if (!normalizedCookie) {
    throw new Error("Cursor cookie header is empty.");
  }

  const summary = await requestCursorJson<CursorUsageSummary>("/api/usage-summary", normalizedCookie);
  if (!summary) {
    throw new Error("Cursor usage summary is unavailable.");
  }

  const user = await requestCursorJson<CursorUserInfo>("/api/auth/me", normalizedCookie, { allowUnauthorized: true });
  const userIdForLegacy = safeString(user?.sub);
  const legacyUsage = userIdForLegacy
    ? await requestCursorJson<CursorLegacyUsageResponse>(
        `/api/usage?user=${encodeURIComponent(userIdForLegacy)}`,
        normalizedCookie,
        {
          allowUnauthorized: true,
        },
      )
    : undefined;

  const quotas = mapCursorUsageToQuotas(summary, legacyUsage);
  const planLabel = toMembershipLabel(summary.membershipType ?? summary.membership_type) ?? "Session";
  const email = safeString(user?.email);
  const billingStart = parseDateLike(summary.billingCycleStart ?? summary.billing_cycle_start);
  const billingEnd = parseDateLike(summary.billingCycleEnd ?? summary.billing_cycle_end);
  const autoMessage = safeString(
    summary.autoModelSelectedDisplayMessage ?? summary.auto_model_selected_display_message,
  );
  const namedMessage = safeString(
    summary.namedModelSelectedDisplayMessage ?? summary.named_model_selected_display_message,
  );
  const membershipRaw = safeString(summary.membershipType ?? summary.membership_type);
  const limitType = safeString(summary.limitType ?? summary.limit_type);
  const isUnlimited = summary.isUnlimited === true || summary.is_unlimited === true;
  const userId = safeString(user?.sub);

  return {
    provider: "cursor",
    planLabel: email ? `${planLabel} (${email})` : planLabel,
    fetchedAt: new Date().toISOString(),
    quotas,
    source: "api",
    metadataSections: [
      {
        id: "account",
        title: "Account",
        items: [
          { label: "Plan", value: planLabel },
          { label: "Membership raw", value: membershipRaw ?? "unknown" },
          { label: "Email", value: email ?? "unknown" },
          { label: "User ID", value: userId ? `${userId.slice(0, 4)}...${userId.slice(-4)}` : "unknown" },
        ],
      },
      {
        id: "source",
        title: "Source",
        items: [
          { label: "Source", value: "Cursor web API" },
          { label: "Primary endpoint", value: `${CURSOR_BASE_URL}/api/usage-summary` },
          { label: "Auth endpoint", value: `${CURSOR_BASE_URL}/api/auth/me` },
          { label: "Legacy endpoint", value: `${CURSOR_BASE_URL}/api/usage?user=<id>` },
        ],
      },
      {
        id: "billing",
        title: "Billing",
        items: [
          { label: "Cycle start", value: billingStart ?? "unknown" },
          { label: "Cycle end", value: billingEnd ?? "unknown" },
          { label: "Days remaining", value: formatDaysRemaining(billingEnd) },
          { label: "Reset policy", value: "Billing cycle end from usage-summary" },
        ],
      },
      {
        id: "policy",
        title: "Policy",
        items: [
          { label: "Limit type", value: limitType ?? "unknown" },
          { label: "Unlimited", value: isUnlimited ? "yes" : "no" },
        ],
      },
      {
        id: "model-behavior",
        title: "Model Behavior",
        items: [
          { label: "Auto model message", value: autoMessage ?? "n/a" },
          { label: "Named model message", value: namedMessage ?? "n/a" },
        ],
      },
    ],
    rawPayload: {
      summary,
      user,
      legacyUsage,
    },
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Monthly reset at Cursor billing cycle end.",
  };
}
