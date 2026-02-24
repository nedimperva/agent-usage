import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { scanLocalCostSummary } from "../lib/cost";
import { parseDateLike, parseOptionalNumber, safeString, statusFromRemainingPercent } from "../lib/normalize";

const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

interface ClaudeCredentials {
  accessToken: string;
  rateLimitTier?: string;
  accountEmail?: string;
  scopes?: string[];
  expiresAt?: string;
  sourcePath?: string;
}

interface ClaudeOAuthUsageWindow {
  utilization?: unknown;
  resets_at?: unknown;
}

interface ClaudeOAuthUsageResponse {
  five_hour?: ClaudeOAuthUsageWindow;
  seven_day?: ClaudeOAuthUsageWindow;
  seven_day_oauth_apps?: ClaudeOAuthUsageWindow;
  seven_day_sonnet?: ClaudeOAuthUsageWindow;
  seven_day_opus?: ClaudeOAuthUsageWindow;
  iguana_necktie?: ClaudeOAuthUsageWindow;
  extra_usage?: {
    is_enabled?: unknown;
    used_credits?: unknown;
    monthly_limit?: unknown;
    utilization?: unknown;
    currency?: unknown;
  };
}

function splitConfigDirs(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of paths) {
    const normalized = path.normalize(value);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function deepFindString(input: unknown, keys: string[]): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const queue: unknown[] = [input];
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null) {
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of keys) {
      const maybe = safeString(record[key]);
      if (maybe) {
        return maybe;
      }
    }

    queue.push(...Object.values(record));
  }

  return undefined;
}

function resolveCredentialPaths(): string[] {
  const home = os.homedir();
  const envRoots = splitConfigDirs(process.env.CLAUDE_CONFIG_DIR);
  const inferredFromEnv = envRoots.flatMap((root) => [
    path.join(root, ".credentials.json"),
    path.join(root, ".claude", ".credentials.json"),
  ]);

  return dedupePaths([
    ...inferredFromEnv,
    path.join(home, ".claude", ".credentials.json"),
    path.join(home, ".config", "claude", ".credentials.json"),
  ]);
}

async function readFirstCredentialsFile(): Promise<{ parsed: unknown; path: string }> {
  const candidates = resolveCredentialPaths();
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      return { parsed: JSON.parse(raw), path: candidate };
    } catch {
      continue;
    }
  }

  throw new Error("Claude credentials not found. Run `claude login` or provide a Claude OAuth access token.");
}

async function loadClaudeCredentials(manualToken?: string): Promise<ClaudeCredentials> {
  const directToken = manualToken?.trim();
  if (directToken) {
    return {
      accessToken: directToken.replace(/^Bearer\s+/i, ""),
      rateLimitTier: undefined,
      sourcePath: "manual preference",
    };
  }

  const { parsed, path: sourcePath } = await readFirstCredentialsFile();
  const accessToken = deepFindString(parsed, ["accessToken", "access_token", "token"]);
  if (!accessToken) {
    throw new Error("Claude credentials found, but no OAuth access token was present.");
  }

  const rateLimitTier = deepFindString(parsed, ["rateLimitTier", "rate_limit_tier"]);
  const accountEmail = deepFindString(parsed, ["email", "accountEmail", "account_email"]);
  const rawExpiresAt = deepFindString(parsed, ["expiresAt", "expires_at", "expiration", "expiry"]);
  const expiresAt = parseDateLike(rawExpiresAt) ?? rawExpiresAt;

  const scopes = (() => {
    const queue: unknown[] = [parsed];
    while (queue.length > 0) {
      const current = queue.shift();
      if (typeof current !== "object" || current === null) {
        continue;
      }
      if (Array.isArray(current)) {
        const asStrings = current.map((value) => safeString(value)).filter((value): value is string => !!value);
        if (asStrings.length > 0 && asStrings.some((scope) => scope.includes(":"))) {
          return asStrings;
        }
        queue.push(...current);
        continue;
      }
      const record = current as Record<string, unknown>;
      const maybeScopes = record.scopes;
      if (Array.isArray(maybeScopes)) {
        const values = maybeScopes.map((value) => safeString(value)).filter((value): value is string => !!value);
        if (values.length > 0) {
          return values;
        }
      }
      queue.push(...Object.values(record));
    }
    return undefined;
  })();

  return {
    accessToken,
    rateLimitTier,
    accountEmail,
    scopes,
    expiresAt,
    sourcePath,
  };
}

function toPlanLabel(rateLimitTier?: string): string {
  const tier = rateLimitTier?.toLowerCase() ?? "";
  if (tier.includes("max")) {
    return "Max";
  }
  if (tier.includes("pro")) {
    return "Pro";
  }
  if (tier.includes("team")) {
    return "Team";
  }
  if (tier.includes("enterprise")) {
    return "Enterprise";
  }
  return "OAuth";
}

function toQuotaFromWindow(
  window: ClaudeOAuthUsageWindow | undefined,
  label: string,
  id: string,
): QuotaItem | undefined {
  const rawUtilization = parseOptionalNumber(window?.utilization);
  if (rawUtilization === undefined) {
    return undefined;
  }

  const usedPercent = rawUtilization <= 1 ? rawUtilization * 100 : rawUtilization;
  const normalizedUsedPercent = Math.max(0, Math.min(100, usedPercent));
  const remainingPercent = Math.max(0, Math.min(100, 100 - normalizedUsedPercent));
  const resetAt = parseDateLike(window?.resets_at);
  return {
    id,
    label,
    remainingPercent,
    remainingDisplay: `${remainingPercent.toFixed(1).replace(/\.0$/, "")}% left (${normalizedUsedPercent
      .toFixed(1)
      .replace(/\.0$/, "")}% used)`,
    resetAt,
    trendBadge: `${normalizedUsedPercent.toFixed(1).replace(/\.0$/, "")}% used`,
    status: statusFromRemainingPercent(remainingPercent),
  };
}

export function mapClaudeUsageToQuotas(payload: ClaudeOAuthUsageResponse): QuotaItem[] {
  const quotas: QuotaItem[] = [];
  const primary = toQuotaFromWindow(payload.five_hour, "5 Hour Limit", "claude-five-hour");
  const weekly = toQuotaFromWindow(payload.seven_day, "Weekly Limit", "claude-weekly");
  const oauthApps = toQuotaFromWindow(payload.seven_day_oauth_apps, "OAuth Apps Weekly", "claude-oauth-apps-weekly");
  const sonnet = toQuotaFromWindow(payload.seven_day_sonnet, "Sonnet Weekly", "claude-sonnet-weekly");
  const opus = toQuotaFromWindow(payload.seven_day_opus, "Opus Weekly", "claude-opus-weekly");
  const iguana = toQuotaFromWindow(payload.iguana_necktie, "Iguana Necktie", "claude-iguana-necktie");

  if (primary) {
    quotas.push(primary);
  }
  if (weekly) {
    quotas.push(weekly);
  }
  if (oauthApps) {
    quotas.push(oauthApps);
  }
  if (sonnet) {
    quotas.push(sonnet);
  }
  if (opus) {
    quotas.push(opus);
  }
  if (iguana) {
    quotas.push(iguana);
  }

  const extra = payload.extra_usage;
  const enabled = extra?.is_enabled === true;
  const usedCredits = parseOptionalNumber(extra?.used_credits);
  const monthlyLimit = parseOptionalNumber(extra?.monthly_limit);
  const utilization = parseOptionalNumber(extra?.utilization);

  if (enabled && usedCredits !== undefined && monthlyLimit !== undefined && monthlyLimit > 0) {
    const currency = safeString(extra?.currency) ?? "USD";
    const usedMajor = usedCredits / 100;
    const limitMajor = monthlyLimit / 100;
    const remainingMajor = Math.max(0, limitMajor - usedMajor);
    const remainingPercent = (remainingMajor / limitMajor) * 100;
    const usedPercent = Math.max(0, Math.min(100, (usedMajor / limitMajor) * 100));

    quotas.push({
      id: "claude-extra-usage",
      label: "Extra Usage Budget",
      remainingPercent,
      remainingDisplay: `${currency} ${remainingMajor.toFixed(2)} left of ${currency} ${limitMajor.toFixed(2)}`,
      trendBadge: `${usedPercent.toFixed(1).replace(/\.0$/, "")}% used`,
      status: statusFromRemainingPercent(remainingPercent),
    });
  } else if (enabled && utilization !== undefined) {
    const usedPercent = utilization <= 1 ? utilization * 100 : utilization;
    const normalizedUsed = Math.max(0, Math.min(100, usedPercent));
    const remainingPercent = Math.max(0, Math.min(100, 100 - normalizedUsed));
    quotas.push({
      id: "claude-extra-usage",
      label: "Extra Usage Budget",
      remainingPercent,
      remainingDisplay: `${remainingPercent.toFixed(1).replace(/\.0$/, "")}% left`,
      trendBadge: `${normalizedUsed.toFixed(1).replace(/\.0$/, "")}% used`,
      status: statusFromRemainingPercent(remainingPercent),
    });
  }

  return quotas;
}

export async function fetchClaudeSnapshot(manualAccessToken?: string): Promise<ProviderUsageSnapshot> {
  const credentials = await loadClaudeCredentials(manualAccessToken);

  const response = await fetch(CLAUDE_OAUTH_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "agent-usage-raycast",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Claude OAuth token is invalid or missing required scope (`user:profile`). Re-run `claude login`.",
      );
    }
    const body = await response.text();
    throw new Error(`Claude OAuth usage API ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = (await response.json()) as ClaudeOAuthUsageResponse;
  const quotas = mapClaudeUsageToQuotas(payload);
  if (quotas.length === 0) {
    throw new Error("Claude usage API returned no parseable usage windows.");
  }

  const configRoots = splitConfigDirs(process.env.CLAUDE_CONFIG_DIR);
  const claudeProjectRoots = [
    ...configRoots.map((root) => path.join(root, "projects")),
    path.join(os.homedir(), ".config", "claude", "projects"),
    path.join(os.homedir(), ".claude", "projects"),
  ];
  const localCost = await scanLocalCostSummary({
    roots: claudeProjectRoots,
    maxFiles: 150,
    maxAgeDays: 30,
  });

  const hasUserProfileScope = credentials.scopes?.includes("user:profile") ?? false;

  return {
    provider: "claude",
    planLabel: toPlanLabel(credentials.rateLimitTier),
    fetchedAt: new Date().toISOString(),
    quotas,
    source: "api",
    metadataSections: [
      {
        id: "account",
        title: "Account",
        items: [
          { label: "Plan", value: toPlanLabel(credentials.rateLimitTier) },
          { label: "Email", value: credentials.accountEmail ?? "unknown" },
          { label: "Tier raw", value: credentials.rateLimitTier ?? "unknown" },
        ],
      },
      {
        id: "source",
        title: "Source",
        items: [
          { label: "Source", value: "OAuth API" },
          { label: "Endpoint", value: CLAUDE_OAUTH_USAGE_URL },
          { label: "Credential source", value: credentials.sourcePath ?? "unknown" },
          { label: "Beta header", value: "oauth-2025-04-20" },
        ],
      },
      {
        id: "auth",
        title: "Auth",
        items: [
          { label: "Has user:profile scope", value: hasUserProfileScope ? "yes" : "no" },
          { label: "Scopes", value: credentials.scopes?.join(", ") ?? "unknown" },
          { label: "Token expiry", value: credentials.expiresAt ?? "unknown" },
        ],
      },
      {
        id: "cost",
        title: "Local Cost (30d)",
        items: localCost
          ? [
              { label: "Files scanned", value: `${localCost.filesScanned}` },
              { label: "Records scanned", value: `${localCost.recordsScanned}` },
              { label: "Input tokens", value: `${localCost.inputTokens}` },
              { label: "Output tokens", value: `${localCost.outputTokens}` },
              { label: "Cached tokens", value: `${localCost.cachedTokens}` },
              { label: "USD cost", value: `${localCost.usdCost.toFixed(4)}` },
            ]
          : [{ label: "Local cost scan", value: "No recent local JSONL usage files found" }],
      },
    ],
    rawPayload: payload,
    staleAfterSeconds: 4 * 60 * 60,
    resetPolicy: "Resets come from `*_window.resets_at` values in `/api/oauth/usage`.",
  };
}
