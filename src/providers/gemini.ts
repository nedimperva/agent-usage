import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import {
  formatPercent,
  parseDateLike,
  parseOptionalNumber,
  safeString,
  statusFromRemainingPercent,
} from "../lib/normalize";

const GEMINI_QUOTA_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GEMINI_LOAD_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const GEMINI_PROJECTS_ENDPOINT = "https://cloudresourcemanager.googleapis.com/v1/projects";

type GeminiAuthType = "oauth-personal" | "api-key" | "vertex-ai" | "unknown";

interface GeminiOAuthCredentials {
  access_token?: unknown;
  id_token?: unknown;
  expiry_date?: unknown;
}

interface GeminiQuotaBucket {
  modelId?: unknown;
  remainingFraction?: unknown;
  resetTime?: unknown;
}

interface GeminiQuotaResponse {
  buckets?: GeminiQuotaBucket[];
}

interface GeminiLoadCodeAssistResponse {
  currentTier?: {
    id?: unknown;
  };
  cloudaicompanionProject?: unknown;
}

interface GeminiProjectsResponse {
  projects?: Array<{
    projectId?: unknown;
    labels?: Record<string, unknown>;
  }>;
}

interface GeminiJWTClaims {
  email?: string;
  hostedDomain?: string;
}

interface GeminiModelQuotaPoint {
  modelId: string;
  remainingPercent: number;
  resetAt?: string;
}

interface GeminiCodeAssistStatus {
  tierId?: string;
  projectId?: string;
}

function resolveGeminiConfigDir(): string {
  return path.join(os.homedir(), ".gemini");
}

async function readJsonFileIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function parseGeminiAuthType(raw: unknown): GeminiAuthType {
  if (raw === "oauth-personal" || raw === "api-key" || raw === "vertex-ai") {
    return raw;
  }
  return "unknown";
}

async function readGeminiAuthType(configDir: string): Promise<GeminiAuthType> {
  const settingsPath = path.join(configDir, "settings.json");
  const parsed = await readJsonFileIfExists(settingsPath);
  if (!parsed || typeof parsed !== "object") {
    return "unknown";
  }

  const settings = parsed as Record<string, unknown>;
  const security = settings.security;
  if (!security || typeof security !== "object") {
    return "unknown";
  }
  const auth = (security as Record<string, unknown>).auth;
  if (!auth || typeof auth !== "object") {
    return "unknown";
  }

  return parseGeminiAuthType((auth as Record<string, unknown>).selectedType);
}

function normalizeAccessToken(value: string): string {
  return value.replace(/^Bearer\s+/i, "").trim();
}

function parseExpiryDate(value: unknown): Date | undefined {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  const asMs = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  const date = new Date(asMs);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function loadGeminiAccessToken(
  manualToken: string | undefined,
  configDir: string,
): Promise<{ accessToken: string; idToken?: string; expiryDate?: Date; source: string }> {
  const direct = manualToken?.trim();
  if (direct) {
    const normalized = normalizeAccessToken(direct);
    if (!normalized) {
      throw new Error("Gemini access token is empty.");
    }
    return {
      accessToken: normalized,
      source: "manual preference",
    };
  }

  const credsPath = path.join(configDir, "oauth_creds.json");
  const parsed = await readJsonFileIfExists(credsPath);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Gemini OAuth credentials not found at ${credsPath}. Run \`gemini\` to authenticate.`);
  }

  const creds = parsed as GeminiOAuthCredentials;
  const accessToken = safeString(creds.access_token);
  if (!accessToken) {
    throw new Error(`Gemini OAuth credentials missing access token at ${credsPath}. Re-run \`gemini\`.`);
  }

  const expiryDate = parseExpiryDate(creds.expiry_date);
  if (expiryDate && expiryDate.getTime() <= Date.now()) {
    throw new Error("Gemini OAuth token is expired. Re-run `gemini` to refresh authentication.");
  }

  return {
    accessToken: normalizeAccessToken(accessToken),
    idToken: safeString(creds.id_token),
    expiryDate,
    source: credsPath,
  };
}

function decodeJWTClaims(idToken?: string): GeminiJWTClaims {
  if (!idToken) {
    return {};
  }

  const segments = idToken.split(".");
  if (segments.length < 2) {
    return {};
  }

  const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4);

  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    return {
      email: safeString(parsed.email),
      hostedDomain: safeString(parsed.hd),
    };
  } catch {
    return {};
  }
}

function parseCodeAssistProject(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return safeString(raw);
  }
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  return safeString(record.id) ?? safeString(record.projectId);
}

async function loadGeminiCodeAssistStatus(accessToken: string): Promise<GeminiCodeAssistStatus> {
  const response = await fetch(GEMINI_LOAD_CODE_ASSIST_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metadata: {
        ideType: "GEMINI_CLI",
        pluginType: "GEMINI",
      },
    }),
  });

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as GeminiLoadCodeAssistResponse;
  return {
    tierId: safeString(payload.currentTier?.id),
    projectId: parseCodeAssistProject(payload.cloudaicompanionProject),
  };
}

async function discoverGeminiProjectId(accessToken: string): Promise<string | undefined> {
  const response = await fetch(GEMINI_PROJECTS_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as GeminiProjectsResponse;
  for (const project of payload.projects ?? []) {
    const projectId = safeString(project.projectId);
    if (!projectId) {
      continue;
    }

    if (projectId.startsWith("gen-lang-client")) {
      return projectId;
    }

    if (project.labels && typeof project.labels === "object") {
      const labels = project.labels as Record<string, unknown>;
      if ("generative-language" in labels) {
        return projectId;
      }
    }
  }

  return undefined;
}

function normalizeRemainingPercent(raw: unknown): number | undefined {
  const parsed = parseOptionalNumber(raw);
  if (parsed === undefined) {
    return undefined;
  }

  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, percent));
}

function buildGeminiGroupQuota(id: string, label: string, entries: GeminiModelQuotaPoint[]): QuotaItem | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lowest = entries.reduce((min, current) => (current.remainingPercent < min.remainingPercent ? current : min));
  const usedPercent = Math.max(0, 100 - lowest.remainingPercent);
  const modelCount = entries.length;

  return {
    id,
    label,
    remainingPercent: lowest.remainingPercent,
    remainingDisplay: `${formatPercent(lowest.remainingPercent)} left (${formatPercent(usedPercent)} used, ${modelCount} model${
      modelCount === 1 ? "" : "s"
    })`,
    resetAt: lowest.resetAt,
    trendBadge: `Lowest of ${modelCount} model${modelCount === 1 ? "" : "s"}`,
    status: statusFromRemainingPercent(lowest.remainingPercent),
  };
}

export function mapGeminiUsageToQuotas(payload: GeminiQuotaResponse): QuotaItem[] {
  const byModel = new Map<string, GeminiModelQuotaPoint>();
  for (const bucket of payload.buckets ?? []) {
    const modelId = safeString(bucket.modelId);
    const remainingPercent = normalizeRemainingPercent(bucket.remainingFraction);
    if (!modelId || remainingPercent === undefined) {
      continue;
    }

    const candidate: GeminiModelQuotaPoint = {
      modelId,
      remainingPercent,
      resetAt: parseDateLike(bucket.resetTime),
    };
    const existing = byModel.get(modelId);
    if (!existing || candidate.remainingPercent < existing.remainingPercent) {
      byModel.set(modelId, candidate);
    }
  }

  const modelPoints = Array.from(byModel.values());
  const proModels = modelPoints.filter((entry) => entry.modelId.toLowerCase().includes("pro"));
  const flashModels = modelPoints.filter((entry) => entry.modelId.toLowerCase().includes("flash"));

  const quotas: QuotaItem[] = [];
  const proQuota = buildGeminiGroupQuota("gemini-pro", "Pro Models", proModels);
  const flashQuota = buildGeminiGroupQuota("gemini-flash", "Flash Models", flashModels);
  if (proQuota) {
    quotas.push(proQuota);
  }
  if (flashQuota) {
    quotas.push(flashQuota);
  }

  if (quotas.length === 0 && modelPoints.length > 0) {
    const allModelsQuota = buildGeminiGroupQuota("gemini-models", "Gemini Models", modelPoints);
    if (allModelsQuota) {
      quotas.push(allModelsQuota);
    }
  }

  return quotas;
}

function mapGeminiTierToPlanLabel(tierId: string | undefined, hostedDomain: string | undefined): string {
  if (tierId === "standard-tier") {
    return "Paid";
  }
  if (tierId === "free-tier") {
    return hostedDomain ? "Workspace" : "Free";
  }
  if (tierId === "legacy-tier") {
    return "Legacy";
  }
  return "OAuth";
}

export async function fetchGeminiSnapshot(manualAccessToken?: string): Promise<ProviderUsageSnapshot> {
  const configDir = resolveGeminiConfigDir();
  const manual = manualAccessToken?.trim();
  if (!manual) {
    const authType = await readGeminiAuthType(configDir);
    if (authType === "api-key") {
      throw new Error("Gemini API-key auth mode is unsupported for quota tracking. Use OAuth via `gemini`.");
    }
    if (authType === "vertex-ai") {
      throw new Error("Gemini Vertex AI auth mode is unsupported for quota tracking. Use OAuth via `gemini`.");
    }
  }

  const credentials = await loadGeminiAccessToken(manual, configDir);
  const claims = decodeJWTClaims(credentials.idToken);
  const codeAssist = await loadGeminiCodeAssistStatus(credentials.accessToken);
  const projectId = codeAssist.projectId ?? (await discoverGeminiProjectId(credentials.accessToken));
  const quotaBody = projectId ? { project: projectId } : {};

  const quotaResponse = await fetch(GEMINI_QUOTA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(quotaBody),
  });

  if (!quotaResponse.ok) {
    if (quotaResponse.status === 401 || quotaResponse.status === 403) {
      throw new Error("Gemini OAuth token is invalid or expired. Re-run `gemini` and refresh.");
    }
    const body = await quotaResponse.text();
    throw new Error(`Gemini quota API ${quotaResponse.status}: ${body.slice(0, 220)}`);
  }

  const payload = (await quotaResponse.json()) as GeminiQuotaResponse;
  const quotas = mapGeminiUsageToQuotas(payload);
  if (quotas.length === 0) {
    throw new Error("Gemini quota API returned no parseable model buckets.");
  }

  const planLabel = mapGeminiTierToPlanLabel(codeAssist.tierId, claims.hostedDomain);
  const displayLabel = claims.email ? `${planLabel} (${claims.email})` : planLabel;
  const highlights = [codeAssist.tierId ? `Tier: ${codeAssist.tierId}` : undefined].filter(
    (entry): entry is string => !!entry,
  );

  return {
    provider: "gemini",
    planLabel: displayLabel,
    fetchedAt: new Date().toISOString(),
    quotas,
    highlights,
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Auth source", value: credentials.source },
          { label: "Auth type", value: manual ? "manual token" : "oauth-personal" },
          { label: "Tier", value: codeAssist.tierId ?? "unknown" },
        ],
      },
      {
        id: "billing",
        title: "Billing",
        items: [
          { label: "Window", value: "24h per model bucket" },
          { label: "Project", value: projectId ?? "unknown" },
          { label: "Quota endpoint", value: GEMINI_QUOTA_ENDPOINT },
        ],
      },
    ],
    rawPayload: {
      quota: payload,
      tier: codeAssist,
      claims: {
        email: claims.email,
        hostedDomain: claims.hostedDomain,
      },
      requestProject: projectId,
    },
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Resets come from `buckets[].resetTime` in Gemini quota API.",
  };
}
