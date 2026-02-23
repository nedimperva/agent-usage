import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import { parseOptionalNumber, safeString, statusFromRemainingPercent } from "../lib/normalize";

const GITHUB_BASE_URL = "https://api.github.com";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_VSCODE_CLIENT_ID = "Iv1.b507a08c87ecfe98";

export interface CopilotDeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface CopilotQuotaSnapshot {
  percent_remaining?: unknown;
  percentRemaining?: unknown;
}

interface CopilotInternalResponse {
  copilot_plan?: unknown;
  copilotPlan?: unknown;
  quota_snapshots?: {
    premium_interactions?: CopilotQuotaSnapshot;
    chat?: CopilotQuotaSnapshot;
  };
  quotaSnapshots?: {
    premiumInteractions?: CopilotQuotaSnapshot;
    chat?: CopilotQuotaSnapshot;
  };
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, value));
}

function readQuotaPercent(snapshot: CopilotQuotaSnapshot | undefined): number | undefined {
  const remaining = parseOptionalNumber(snapshot?.percent_remaining) ?? parseOptionalNumber(snapshot?.percentRemaining);
  return normalizePercent(remaining);
}

export function extractCopilotQuotaItems(payload: unknown): QuotaItem[] {
  const usage = (payload as CopilotInternalResponse | undefined) ?? {};
  const premiumRemaining = readQuotaPercent(
    usage.quotaSnapshots?.premiumInteractions ?? usage.quota_snapshots?.premium_interactions,
  );
  const chatRemaining = readQuotaPercent(usage.quotaSnapshots?.chat ?? usage.quota_snapshots?.chat);
  const quotas: QuotaItem[] = [];

  if (premiumRemaining !== undefined) {
    quotas.push({
      id: "copilot-premium",
      label: "Premium Requests",
      remainingPercent: premiumRemaining,
      remainingDisplay: `${premiumRemaining.toFixed(1).replace(/\.0$/, "")}% left`,
      status: statusFromRemainingPercent(premiumRemaining),
    });
  }

  if (chatRemaining !== undefined) {
    quotas.push({
      id: "copilot-chat",
      label: "Chat Quota",
      remainingPercent: chatRemaining,
      remainingDisplay: `${chatRemaining.toFixed(1).replace(/\.0$/, "")}% left`,
      status: statusFromRemainingPercent(chatRemaining),
    });
  }

  if (quotas.length === 0) {
    quotas.push({
      id: "copilot-empty",
      label: "Copilot Usage",
      remainingDisplay: "No quota snapshots available from Copilot API.",
      status: "unknown",
    });
  }

  return quotas;
}

function createFormBody(values: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  return params.toString();
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub OAuth ${response.status}: ${body.slice(0, 220)}`);
  }
  return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestCopilotDeviceCode(): Promise<CopilotDeviceCodeResponse> {
  const payload = await requestJson<{
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
  }>(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: createFormBody({
      client_id: COPILOT_VSCODE_CLIENT_ID,
      scope: "read:user",
    }),
  });

  const deviceCode = safeString(payload.device_code);
  const userCode = safeString(payload.user_code);
  const verificationUri = safeString(payload.verification_uri);
  const expiresIn = payload.expires_in ?? 900;
  const interval = payload.interval ?? 5;

  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("GitHub device flow response was missing required fields.");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn,
    interval,
  };
}

export async function pollCopilotDeviceToken(device: CopilotDeviceCodeResponse): Promise<string> {
  const startedAt = Date.now();
  let intervalSec = device.interval;

  while (Date.now() - startedAt < device.expiresIn * 1000) {
    await sleep(intervalSec * 1000);

    const response = await requestJson<{
      access_token?: string;
      error?: string;
    }>(GITHUB_DEVICE_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: createFormBody({
        client_id: COPILOT_VSCODE_CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const token = safeString(response.access_token);
    if (token) {
      return token;
    }

    if (response.error === "authorization_pending") {
      continue;
    }

    if (response.error === "slow_down") {
      intervalSec += 5;
      continue;
    }

    if (response.error === "expired_token") {
      throw new Error("Device code expired. Start Copilot login again.");
    }

    throw new Error(`GitHub device flow failed: ${response.error ?? "unknown_error"}`);
  }

  throw new Error("Timed out waiting for GitHub device authorization.");
}

export async function fetchCopilotSnapshot(token: string): Promise<ProviderUsageSnapshot> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error("Copilot token is missing.");
  }

  const response = await fetch(`${GITHUB_BASE_URL}/copilot_internal/user`, {
    method: "GET",
    headers: {
      Authorization: `token ${trimmedToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-Github-Api-Version": "2025-04-01",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Copilot token is invalid. Reconnect Copilot or set a new token.");
    }
    const body = await response.text();
    throw new Error(`Copilot usage API ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = (await response.json()) as CopilotInternalResponse;
  const planLabel = safeString(payload.copilotPlan) ?? safeString(payload.copilot_plan) ?? "Account";
  return {
    provider: "copilot",
    planLabel,
    fetchedAt: new Date().toISOString(),
    quotas: extractCopilotQuotaItems(payload),
    source: "api",
  };
}
