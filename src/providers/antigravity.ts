import { execFile } from "child_process";
import { ProviderUsageSnapshot, QuotaItem } from "../models/usage";
import {
  formatPercent,
  parseDateLike,
  parseOptionalNumber,
  safeString,
  statusFromRemainingPercent,
} from "../lib/normalize";

interface AntigravityPlanInfo {
  planName?: unknown;
  planDisplayName?: unknown;
  displayName?: unknown;
  productName?: unknown;
  planShortName?: unknown;
}

interface AntigravityModelConfig {
  label?: unknown;
  modelOrAlias?: {
    model?: unknown;
  };
  quotaInfo?: {
    remainingFraction?: unknown;
    resetTime?: unknown;
  };
}

interface AntigravityStatusResponse {
  code?: unknown;
  message?: unknown;
  userStatus?: {
    email?: unknown;
    planStatus?: {
      planInfo?: AntigravityPlanInfo;
    };
    cascadeModelConfigData?: {
      clientModelConfigs?: AntigravityModelConfig[];
    };
  };
  clientModelConfigs?: AntigravityModelConfig[];
}

interface AntigravityRequestResult {
  payload: AntigravityStatusResponse;
  endpointUrl: string;
}

interface AntigravityMergedRequestResult {
  payload: AntigravityStatusResponse;
  endpointUrl: string;
  supplementalEndpoints: string[];
}

interface AntigravityConnection {
  baseUrl: string;
  csrfToken: string;
  source: string;
}

interface AntigravityProcessInfo {
  pid: number;
  commandLine: string;
}

const USER_STATUS_PATH = "/exa.language_server_pb.LanguageServerService/GetUserStatus";
const COMMAND_MODELS_PATH = "/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs";

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function toComparableCode(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && /^[0-9]+$/.test(trimmed)) {
      return numeric;
    }
    return trimmed.toLowerCase();
  }
  return undefined;
}

function isSuccessCode(code: unknown): boolean {
  const comparable = toComparableCode(code);
  if (comparable === undefined) {
    return true;
  }
  if (typeof comparable === "number") {
    return comparable === 0;
  }
  return comparable === "ok" || comparable === "success" || comparable === "0";
}

function normalizeRemainingPercent(raw: unknown): number | undefined {
  const parsed = parseOptionalNumber(raw);
  if (parsed === undefined) {
    return undefined;
  }

  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, percent));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseFlagFromCommandLine(commandLine: string, flag: string): string | undefined {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = commandLine.match(new RegExp(`${escaped}(?:=|\\s+)(\\S+)`, "i"));
  const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  return value ? value : undefined;
}

export function extractAntigravityConnectionFromCommandLine(commandLine: string): {
  csrfToken?: string;
  port?: number;
} {
  const csrfToken = parseFlagFromCommandLine(commandLine, "--csrf_token");
  const rawPort = parseFlagFromCommandLine(commandLine, "--extension_server_port");
  const port = rawPort ? Number(rawPort) : undefined;

  return {
    csrfToken,
    port: port && Number.isFinite(port) && port > 0 ? port : undefined,
  };
}

async function runCommand(binary: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).toString().trim()));
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

function parseWindowsProcessLines(output: string): AntigravityProcessInfo[] {
  const rows: AntigravityProcessInfo[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const tabIndex = line.indexOf("\t");
    if (tabIndex <= 0) {
      continue;
    }

    const pidText = line.slice(0, tabIndex).trim();
    const commandLine = line.slice(tabIndex + 1).trim();
    const pid = Number(pidText);
    if (!Number.isFinite(pid) || pid <= 0 || !commandLine) {
      continue;
    }

    rows.push({ pid, commandLine });
  }
  return rows;
}

function parseListeningPortsForPidFromNetstat(output: string, pid: number): number[] {
  const ports = new Set<number>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.toUpperCase().includes("LISTENING")) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }

    const rowPid = Number(parts[parts.length - 1]);
    if (!Number.isFinite(rowPid) || rowPid !== pid) {
      continue;
    }

    const localAddress = parts[1];
    const match = localAddress.match(/:(\d+)$/);
    const port = match ? Number(match[1]) : NaN;
    if (Number.isFinite(port) && port > 0) {
      ports.add(port);
    }
  }
  return Array.from(ports.values()).sort((a, b) => a - b);
}

async function probeAntigravityPort(port: number, csrfToken: string): Promise<string | undefined> {
  const schemes: Array<"http" | "https"> = ["http", "https"];
  for (const scheme of schemes) {
    const baseUrl = `${scheme}://127.0.0.1:${port}`;
    try {
      const result = await requestAntigravity(baseUrl, csrfToken, USER_STATUS_PATH, {});
      if (result.payload.userStatus || result.payload.clientModelConfigs) {
        return baseUrl;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

async function discoverWindowsConnection(): Promise<AntigravityConnection | undefined> {
  const output = await runCommand("powershell", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server_windows*.exe' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }",
  ]).catch(() => undefined);

  if (!output) {
    return undefined;
  }

  const processes = parseWindowsProcessLines(output);
  if (processes.length === 0) {
    return undefined;
  }

  const netstatOutput = await runCommand("netstat", ["-ano", "-p", "tcp"]).catch(() => undefined);

  for (const processInfo of processes) {
    const parsed = extractAntigravityConnectionFromCommandLine(processInfo.commandLine);
    if (!parsed.csrfToken) {
      continue;
    }

    const candidatePorts = new Set<number>();
    if (parsed.port) {
      candidatePorts.add(parsed.port);
    }
    if (netstatOutput) {
      for (const port of parseListeningPortsForPidFromNetstat(netstatOutput, processInfo.pid)) {
        candidatePorts.add(port);
      }
    }

    for (const port of candidatePorts.values()) {
      const baseUrl = await probeAntigravityPort(port, parsed.csrfToken);
      if (!baseUrl) {
        continue;
      }
      return {
        baseUrl,
        csrfToken: parsed.csrfToken,
        source: `auto:language_server_windows(pid=${processInfo.pid})`,
      };
    }
  }

  return undefined;
}

async function discoverPosixConnection(): Promise<AntigravityConnection | undefined> {
  const output = await runCommand("/bin/ps", ["-ax", "-o", "command="]).catch(() => undefined);
  if (!output) {
    return undefined;
  }

  for (const line of output.split(/\r?\n/)) {
    const commandLine = line.trim();
    if (!commandLine) {
      continue;
    }
    const lower = commandLine.toLowerCase();
    if (!lower.includes("language_server") || !lower.includes("antigravity")) {
      continue;
    }

    const parsed = extractAntigravityConnectionFromCommandLine(commandLine);
    if (parsed.port && parsed.csrfToken) {
      const probedBaseUrl = await probeAntigravityPort(parsed.port, parsed.csrfToken);
      return {
        baseUrl: probedBaseUrl ?? `http://127.0.0.1:${parsed.port}`,
        csrfToken: parsed.csrfToken,
        source: "auto:language_server_posix",
      };
    }
  }

  return undefined;
}

async function discoverAntigravityConnection(): Promise<AntigravityConnection | undefined> {
  if (process.platform === "win32") {
    return discoverWindowsConnection();
  }

  if (process.platform === "darwin" || process.platform === "linux") {
    return discoverPosixConnection();
  }

  return undefined;
}

function isClaudeModel(input: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes("claude");
}

function isGeminiProModel(input: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes("gemini") && lower.includes("pro");
}

function isGeminiFlash(input: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes("gemini") && lower.includes("flash");
}

function pickFriendlyLabel(input: string): string {
  if (isClaudeModel(input)) {
    return "Claude";
  }
  if (isGeminiProModel(input)) {
    return "Gemini Pro";
  }
  if (isGeminiFlash(input)) {
    return "Gemini Flash";
  }
  return input;
}

function pickTopQuotas(quotas: QuotaItem[]): QuotaItem[] {
  if (quotas.length <= 3) {
    return quotas;
  }

  const selected: QuotaItem[] = [];
  const addFirst = (predicate: (quota: QuotaItem) => boolean) => {
    const found = quotas.find((quota) => predicate(quota));
    if (!found) {
      return;
    }
    if (selected.some((existing) => existing.id === found.id)) {
      return;
    }
    selected.push(found);
  };

  addFirst((quota) => isClaudeModel(quota.label));
  addFirst((quota) => isGeminiProModel(quota.label));
  addFirst((quota) => isGeminiFlash(quota.label));
  const remainder = [...quotas]
    .sort((a, b) => (a.remainingPercent ?? 0) - (b.remainingPercent ?? 0))
    .filter((quota) => !selected.some((item) => item.id === quota.id));
  for (const quota of remainder) {
    if (selected.length >= 3) {
      break;
    }
    selected.push(quota);
  }
  return selected.slice(0, 3);
}

function quotaCoverageScore(quotas: QuotaItem[]): number {
  const hasClaude = quotas.some((quota) => isClaudeModel(quota.label));
  const hasGeminiPro = quotas.some((quota) => isGeminiProModel(quota.label));
  const hasGeminiFlash = quotas.some((quota) => isGeminiFlash(quota.label));
  const preferredCoverage = [hasClaude, hasGeminiPro, hasGeminiFlash].filter(Boolean).length;
  return quotas.length * 10 + preferredCoverage * 100;
}

function mergeModelConfigs(
  primary: AntigravityModelConfig[] | undefined,
  secondary: AntigravityModelConfig[] | undefined,
): AntigravityModelConfig[] {
  const merged = new Map<string, AntigravityModelConfig>();

  const upsert = (config: AntigravityModelConfig, index: number) => {
    const modelId = safeString(config.modelOrAlias?.model);
    const label = safeString(config.label);
    const identity = modelId ?? label ?? `idx-${index}`;
    const existing = merged.get(identity);

    if (!existing) {
      merged.set(identity, {
        label: config.label,
        modelOrAlias: config.modelOrAlias ? { model: config.modelOrAlias.model } : undefined,
        quotaInfo: config.quotaInfo
          ? {
              remainingFraction: config.quotaInfo.remainingFraction,
              resetTime: config.quotaInfo.resetTime,
            }
          : undefined,
      });
      return;
    }

    const nextRemaining =
      config.quotaInfo?.remainingFraction !== undefined
        ? config.quotaInfo.remainingFraction
        : existing.quotaInfo?.remainingFraction;
    const nextReset =
      config.quotaInfo?.resetTime !== undefined ? config.quotaInfo.resetTime : existing.quotaInfo?.resetTime;

    merged.set(identity, {
      label: label ? config.label : existing.label,
      modelOrAlias: {
        model: modelId ?? existing.modelOrAlias?.model,
      },
      quotaInfo:
        nextRemaining !== undefined || nextReset !== undefined
          ? { remainingFraction: nextRemaining, resetTime: nextReset }
          : undefined,
    });
  };

  (primary ?? []).forEach((config, index) => upsert(config, index));
  (secondary ?? []).forEach((config, index) => upsert(config, (primary?.length ?? 0) + index));

  return Array.from(merged.values());
}

export function mapAntigravityResponseToQuotas(payload: AntigravityStatusResponse): QuotaItem[] {
  const userModels = payload.userStatus?.cascadeModelConfigData?.clientModelConfigs;
  const commandModels = payload.clientModelConfigs;
  const modelConfigs = mergeModelConfigs(commandModels, userModels);

  const quotas: QuotaItem[] = [];
  for (const config of modelConfigs) {
    const modelId = safeString(config.modelOrAlias?.model) ?? safeString(config.label);
    const resetAt = parseDateLike(config.quotaInfo?.resetTime);
    const remainingPercent = normalizeRemainingPercent(config.quotaInfo?.remainingFraction);
    if (!modelId) {
      continue;
    }

    const label = pickFriendlyLabel(safeString(config.label) ?? modelId);
    const usedPercent = remainingPercent !== undefined ? Math.max(0, 100 - remainingPercent) : undefined;
    quotas.push({
      id: `antigravity-${slug(modelId) || "quota"}`,
      label,
      remainingPercent,
      remainingDisplay:
        remainingPercent !== undefined
          ? `${formatPercent(remainingPercent)} left (${formatPercent(usedPercent ?? 0)} used)`
          : resetAt
            ? "Remaining usage unavailable (reset time provided)."
            : "Remaining usage unavailable.",
      resetAt,
      status: remainingPercent !== undefined ? statusFromRemainingPercent(remainingPercent) : "unknown",
    });
  }

  return pickTopQuotas(quotas);
}

async function requestAntigravityMerged(baseUrl: string, csrfToken: string): Promise<AntigravityMergedRequestResult> {
  let userStatusRequest: AntigravityRequestResult | undefined;
  let commandModelsRequest: AntigravityRequestResult | undefined;
  let userStatusError: Error | undefined;
  let commandModelsError: Error | undefined;

  try {
    userStatusRequest = await requestAntigravity(baseUrl, csrfToken, USER_STATUS_PATH, DEFAULT_REQUEST_BODY);
  } catch (error) {
    userStatusError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    commandModelsRequest = await requestAntigravity(baseUrl, csrfToken, COMMAND_MODELS_PATH, DEFAULT_REQUEST_BODY);
  } catch (error) {
    commandModelsError = error instanceof Error ? error : new Error(String(error));
  }

  const userStatusSuccess = !!userStatusRequest && isSuccessCode(userStatusRequest.payload.code);
  const commandModelsSuccess = !!commandModelsRequest && isSuccessCode(commandModelsRequest.payload.code);

  if (!userStatusSuccess && !commandModelsSuccess) {
    const userMessage = userStatusError?.message ?? "unavailable";
    const commandMessage = commandModelsError?.message ?? "unavailable";
    throw new Error(
      `Antigravity endpoints failed. UserStatus: ${userMessage}. CommandModelConfigs: ${commandMessage}.`,
    );
  }

  const primaryRequest = userStatusSuccess ? userStatusRequest : commandModelsRequest;
  if (!primaryRequest) {
    throw new Error("Antigravity request failed without a successful endpoint.");
  }

  const primaryPayload = primaryRequest.payload;
  const secondaryPayload =
    primaryRequest === userStatusRequest ? commandModelsRequest?.payload : userStatusRequest?.payload;
  const mergedPayload: AntigravityStatusResponse = {
    ...(secondaryPayload ?? {}),
    ...(primaryPayload ?? {}),
    code: 0,
    userStatus: primaryPayload.userStatus ?? secondaryPayload?.userStatus,
    clientModelConfigs: mergeModelConfigs(secondaryPayload?.clientModelConfigs, primaryPayload.clientModelConfigs),
  };

  const supplementalEndpoints = [userStatusRequest, commandModelsRequest]
    .filter((request): request is AntigravityRequestResult => !!request)
    .map((request) => request.endpointUrl)
    .filter((url) => url !== primaryRequest.endpointUrl);

  return {
    payload: mergedPayload,
    endpointUrl: primaryRequest.endpointUrl,
    supplementalEndpoints,
  };
}

function preferredPlanName(planInfo: AntigravityPlanInfo | undefined): string | undefined {
  const candidates = [
    safeString(planInfo?.planDisplayName),
    safeString(planInfo?.displayName),
    safeString(planInfo?.productName),
    safeString(planInfo?.planName),
    safeString(planInfo?.planShortName),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

async function postAntigravity(
  endpointUrl: string,
  csrfToken: string,
  body: object,
): Promise<AntigravityStatusResponse> {
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "X-Codeium-Csrf-Token": csrfToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`HTTP ${response.status}: ${payload.slice(0, 220)}`);
  }

  return (await response.json()) as AntigravityStatusResponse;
}

function endpointCandidates(baseUrl: string, path: string): string[] {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return [];
  }

  const direct = `${base}${path}`;
  try {
    const parsed = new URL(base);
    const alternate = new URL(base);
    alternate.protocol = parsed.protocol === "https:" ? "http:" : "https:";
    const alternateUrl = `${alternate.toString().replace(/\/+$/, "")}${path}`;
    return [direct, alternateUrl];
  } catch {
    return [direct];
  }
}

async function requestAntigravity(
  baseUrl: string,
  csrfToken: string,
  path: string,
  body: object,
): Promise<AntigravityRequestResult> {
  const candidates = endpointCandidates(baseUrl, path);
  if (candidates.length === 0) {
    throw new Error("Antigravity server URL is empty.");
  }

  let lastError: Error | undefined;
  for (const url of candidates) {
    try {
      const payload = await postAntigravity(url, csrfToken, body);
      return { payload, endpointUrl: url };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Antigravity request failed.");
}

const DEFAULT_REQUEST_BODY = {};

export async function fetchAntigravitySnapshot(baseUrl?: string, csrfToken?: string): Promise<ProviderUsageSnapshot> {
  const manualBase = baseUrl?.trim();
  const manualToken = csrfToken?.trim();
  const discovered = await discoverAntigravityConnection();
  const normalizedBase = manualBase || discovered?.baseUrl;
  const token = manualToken || discovered?.csrfToken;

  if (!normalizedBase) {
    throw new Error("No Antigravity Server URL found. Set preference or keep Antigravity running for auto-detect.");
  }
  if (!token) {
    throw new Error("No Antigravity CSRF token found. Set preference or keep Antigravity running for auto-detect.");
  }

  let connectionSource =
    manualBase && manualToken ? "manual preferences" : (discovered?.source ?? "manual preferences");

  let request: AntigravityMergedRequestResult | undefined;
  const tryFetch = async (base: string, csrf: string): Promise<AntigravityMergedRequestResult> =>
    requestAntigravityMerged(base, csrf);

  try {
    request = await tryFetch(normalizedBase, token);
  } catch (error) {
    const discoveredBase = discovered?.baseUrl;
    const discoveredToken = discovered?.csrfToken;
    const shouldRetryWithAuto =
      !!manualBase &&
      !!manualToken &&
      !!discoveredBase &&
      !!discoveredToken &&
      (discoveredBase !== normalizedBase || discoveredToken !== token);

    if (!shouldRetryWithAuto) {
      throw error;
    }

    request = await tryFetch(discoveredBase, discoveredToken);
    connectionSource = discovered?.source ?? "auto";
  }

  let quotas = mapAntigravityResponseToQuotas(request.payload);

  const discoveredBase = discovered?.baseUrl;
  const discoveredToken = discovered?.csrfToken;
  const shouldCompareWithAuto =
    !!manualBase &&
    !!discoveredBase &&
    !!discoveredToken &&
    (discoveredBase !== normalizedBase || discoveredToken !== token);

  if (shouldCompareWithAuto) {
    try {
      const discoveredRequest = await tryFetch(discoveredBase, discoveredToken);
      const discoveredQuotas = mapAntigravityResponseToQuotas(discoveredRequest.payload);
      if (quotaCoverageScore(discoveredQuotas) > quotaCoverageScore(quotas)) {
        request = discoveredRequest;
        quotas = discoveredQuotas;
        connectionSource = discovered?.source ?? "auto";
      }
    } catch {
      // Keep manual result when discovered candidate cannot be fetched.
    }
  }

  if (quotas.length === 0) {
    throw new Error("No parseable Antigravity quota models found.");
  }

  const email = safeString(request.payload.userStatus?.email);
  const planName = preferredPlanName(request.payload.userStatus?.planStatus?.planInfo);
  const planLabel = email ? `${planName ?? "Local"} (${email})` : (planName ?? "Local");

  return {
    provider: "antigravity",
    planLabel,
    fetchedAt: new Date().toISOString(),
    quotas,
    highlights: undefined,
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: "Local language server" },
          { label: "Endpoint", value: request.endpointUrl },
          ...(request.supplementalEndpoints.length > 0
            ? [{ label: "Supplemental Endpoints", value: request.supplementalEndpoints.join(", ") }]
            : []),
          { label: "Auth", value: "CSRF token header" },
          { label: "Connection", value: connectionSource },
        ],
      },
    ],
    rawPayload: request.payload,
    staleAfterSeconds: 60 * 60,
    resetPolicy: "Resets come from `quotaInfo.resetTime` per model.",
  };
}
