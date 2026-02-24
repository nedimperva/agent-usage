import { ProviderUsageSnapshot } from "../models/usage";
import { statusFromRemainingPercent } from "../lib/normalize";

const MINIMAX_DEFAULT_ENDPOINTS = [
  "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  "https://api.minimax.io/v1/coding_plan/remains",
  "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
];

interface MiniMaxModelRemains {
  current_interval_total_count?: unknown;
  currentIntervalTotalCount?: unknown;
  total_count?: unknown;
  totalCount?: unknown;
  total?: unknown;
  current_interval_usage_count?: unknown;
  currentIntervalUsageCount?: unknown;
  remaining_count?: unknown;
  remainingCount?: unknown;
  remaining?: unknown;
  current_interval_used_count?: unknown;
  currentIntervalUsedCount?: unknown;
  used_count?: unknown;
  usedCount?: unknown;
  used?: unknown;
  start_time?: unknown;
  startTime?: unknown;
  end_time?: unknown;
  endTime?: unknown;
  remains_time?: unknown;
  remainsTime?: unknown;
}

interface MiniMaxPayload {
  base_resp?: {
    status_code?: unknown;
    status_msg?: unknown;
  };
  data?: {
    base_resp?: {
      status_code?: unknown;
      status_msg?: unknown;
    };
    model_remains?: MiniMaxModelRemains[];
    modelRemains?: MiniMaxModelRemains[];
    current_subscribe_title?: unknown;
    plan_name?: unknown;
    combo_title?: unknown;
    current_plan_title?: unknown;
    current_combo_card?: {
      title?: unknown;
    };
  };
  model_remains?: MiniMaxModelRemains[];
  modelRemains?: MiniMaxModelRemains[];
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function parseEpochDate(value: unknown): Date | undefined {
  const numeric = parseNumber(value);
  if (numeric === undefined || numeric <= 1_000_000_000) {
    return undefined;
  }
  const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function resolveMiniMaxApiKey(manualApiKey?: string): string {
  const candidates = [manualApiKey?.trim(), process.env.MINIMAX_API_KEY?.trim()];
  for (const candidate of candidates) {
    if (candidate) {
      return candidate.replace(/^Bearer\s+/i, "");
    }
  }
  throw new Error("MiniMax API key missing. Set MiniMax API Key in preferences.");
}

function resolveMiniMaxEndpoints(): string[] {
  const fromEnv = [
    process.env.MINIMAX_REMAINS_URL?.trim(),
    process.env.MINIMAX_API_ENDPOINT?.trim(),
    process.env.MINIMAX_API_URL?.trim(),
  ].filter((value): value is string => !!value);

  const combined = [...fromEnv, ...MINIMAX_DEFAULT_ENDPOINTS];
  const normalized = combined.map((value) => value.replace(/\/+$/, "")).filter((value) => /^https?:\/\//i.test(value));
  return Array.from(new Set(normalized));
}

function resolvePlanName(payload: MiniMaxPayload): string | undefined {
  const data = payload.data;
  const candidates = [
    typeof data?.current_subscribe_title === "string" ? data.current_subscribe_title : undefined,
    typeof data?.plan_name === "string" ? data.plan_name : undefined,
    typeof data?.combo_title === "string" ? data.combo_title : undefined,
    typeof data?.current_plan_title === "string" ? data.current_plan_title : undefined,
    typeof data?.current_combo_card?.title === "string" ? data.current_combo_card.title : undefined,
  ];
  return candidates.find((value) => !!value);
}

function resolveStatusError(payload: MiniMaxPayload): string | undefined {
  const statusCode =
    parseNumber(payload.data?.base_resp?.status_code) ?? parseNumber(payload.base_resp?.status_code) ?? 0;
  if (statusCode === 0) {
    return undefined;
  }
  const message =
    (typeof payload.data?.base_resp?.status_msg === "string" ? payload.data?.base_resp?.status_msg : undefined) ??
    (typeof payload.base_resp?.status_msg === "string" ? payload.base_resp?.status_msg : undefined) ??
    `status_code ${statusCode}`;
  return message;
}

function findModelRemainsList(root: unknown): MiniMaxModelRemains[] | undefined {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    const direct = record.model_remains ?? record.modelRemains;
    if (Array.isArray(direct) && direct.length > 0) {
      return direct as MiniMaxModelRemains[];
    }
    queue.push(...Object.values(record));
  }
  return undefined;
}

function resolveModelRemains(payload: MiniMaxPayload): MiniMaxModelRemains | undefined {
  const list = findModelRemainsList(payload);
  if (!list || list.length === 0) {
    return undefined;
  }

  const score = (item: MiniMaxModelRemains): number => {
    const total =
      parseNumber(
        item.current_interval_total_count ??
          item.currentIntervalTotalCount ??
          item.total_count ??
          item.totalCount ??
          item.total,
      ) ?? 0;
    const remaining =
      parseNumber(
        item.current_interval_usage_count ??
          item.currentIntervalUsageCount ??
          item.remaining_count ??
          item.remainingCount ??
          item.remaining,
      ) ?? 0;
    return total * 10 + remaining;
  };

  return [...list].sort((a, b) => score(b) - score(a))[0];
}

async function requestMiniMaxPayload(
  endpoint: string,
  apiKey: string,
): Promise<{ payload: MiniMaxPayload; endpoint: string }> {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const body = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`auth:${endpoint}`);
    }
    throw new Error(`MiniMax API ${response.status} (${endpoint}): ${body.slice(0, 220)}`);
  }

  let payload: MiniMaxPayload;
  try {
    payload = JSON.parse(body) as MiniMaxPayload;
  } catch {
    throw new Error(`MiniMax API returned non-JSON response (${endpoint}).`);
  }

  return { payload, endpoint };
}

export async function fetchMiniMaxSnapshot(manualApiKey?: string): Promise<ProviderUsageSnapshot> {
  const apiKey = resolveMiniMaxApiKey(manualApiKey);
  const endpoints = resolveMiniMaxEndpoints();
  if (endpoints.length === 0) {
    throw new Error("MiniMax endpoint list is empty.");
  }

  let selectedPayload: MiniMaxPayload | undefined;
  let selectedEndpoint: string | undefined;
  let lastError: Error | undefined;
  let sawAuthFailure = false;

  for (const endpoint of endpoints) {
    try {
      const result = await requestMiniMaxPayload(endpoint, apiKey);
      const statusError = resolveStatusError(result.payload);
      if (statusError) {
        if (/cookie|log in|login|invalid|expired/i.test(statusError)) {
          sawAuthFailure = true;
          lastError = new Error("MiniMax session/auth is invalid. Check API key.");
          continue;
        }
        lastError = new Error(`MiniMax API error (${endpoint}): ${statusError}`);
        continue;
      }
      selectedPayload = result.payload;
      selectedEndpoint = result.endpoint;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("auth:")) {
        sawAuthFailure = true;
        lastError = new Error("MiniMax API key is invalid.");
      } else {
        lastError = error instanceof Error ? error : new Error(message);
      }
      continue;
    }
  }

  if (!selectedPayload || !selectedEndpoint) {
    if (sawAuthFailure) {
      throw new Error("MiniMax API key is invalid.");
    }
    throw lastError ?? new Error("MiniMax request failed.");
  }

  const remains = resolveModelRemains(selectedPayload);
  if (!remains) {
    throw new Error("MiniMax response did not include coding plan limits.");
  }

  const total =
    parseNumber(
      remains.current_interval_total_count ??
        remains.currentIntervalTotalCount ??
        remains.total_count ??
        remains.totalCount ??
        remains.total,
    ) ?? undefined;
  const remainingRaw = parseNumber(
    remains.current_interval_usage_count ??
      remains.currentIntervalUsageCount ??
      remains.remaining_count ??
      remains.remainingCount ??
      remains.remaining,
  );
  const usedRaw = parseNumber(
    remains.current_interval_used_count ??
      remains.currentIntervalUsedCount ??
      remains.used_count ??
      remains.usedCount ??
      remains.used,
  );

  let remaining: number | undefined;
  let usedCount: number | undefined;
  if (remainingRaw !== undefined) {
    remaining = Math.max(0, remainingRaw);
    usedCount = total !== undefined ? Math.max(0, total - remaining) : undefined;
  } else if (usedRaw !== undefined) {
    usedCount = Math.max(0, usedRaw);
    remaining = total !== undefined ? Math.max(0, total - usedCount) : undefined;
  }

  const usedPercent =
    total !== undefined && total > 0 && usedCount !== undefined
      ? Math.max(0, Math.min(100, (usedCount / total) * 100))
      : undefined;
  const remainingPercent = usedPercent !== undefined ? Math.max(0, Math.min(100, 100 - usedPercent)) : undefined;

  const start = parseEpochDate(remains.start_time ?? remains.startTime);
  const end = parseEpochDate(remains.end_time ?? remains.endTime);
  const remainsTime = parseNumber(remains.remains_time ?? remains.remainsTime);
  const resetsAt = (() => {
    if (end && end.getTime() > Date.now()) {
      return end.toISOString();
    }
    if (remainsTime !== undefined && remainsTime > 0) {
      const seconds = remainsTime > 1_000_000 ? remainsTime / 1000 : remainsTime;
      return new Date(Date.now() + seconds * 1000).toISOString();
    }
    return undefined;
  })();
  const windowMinutes =
    start && end && end.getTime() > start.getTime() ? Math.round((end.getTime() - start.getTime()) / 60000) : undefined;

  return {
    provider: "minimax",
    planLabel: resolvePlanName(selectedPayload) ?? "API",
    fetchedAt: new Date().toISOString(),
    quotas: [
      {
        id: "minimax-plan",
        label: "Plan Usage",
        remainingPercent,
        remainingDisplay:
          total !== undefined && remaining !== undefined
            ? `${Math.max(0, remaining).toFixed(0)} left of ${Math.max(0, total).toFixed(0)}`
            : total !== undefined && usedCount !== undefined
              ? `${Math.max(0, usedCount).toFixed(0)} used of ${Math.max(0, total).toFixed(0)}`
              : "Usage data available",
        resetAt: resetsAt,
        status: statusFromRemainingPercent(remainingPercent),
      },
    ],
    source: "api",
    metadataSections: [
      {
        id: "usage-mode",
        title: "Usage Mode",
        items: [
          { label: "Source", value: "MiniMax API key" },
          { label: "Endpoint", value: selectedEndpoint },
          { label: "Window", value: windowMinutes !== undefined ? `${windowMinutes} minutes` : "unknown" },
        ],
      },
    ],
    rawPayload: selectedPayload,
    staleAfterSeconds: 2 * 60 * 60,
    resetPolicy: "Resets come from MiniMax coding plan response (`end_time`/`remains_time`).",
  };
}
