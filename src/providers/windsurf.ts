import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  buildCountQuota,
  buildSnapshot,
  parseJsonObjectFromText,
  readFirstDate,
  readFirstNumber,
  readFirstString,
  requestJson,
  resolveCookieCandidates,
} from "./provider-helpers";

type CookieMode = "auto" | "manual";

interface WindsurfOptions {
  cookieHeader?: string;
  cookieSourceMode?: CookieMode;
  cachedCookieHeader?: string;
  usageUrl?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

const DEFAULT_ENDPOINTS = [
  "https://windsurf.com/api/usage",
  "https://windsurf.com/api/billing/usage",
  "https://codeium.com/api/usage",
];

function normalizeMode(value?: string): CookieMode {
  return value?.toLowerCase() === "manual" ? "manual" : "auto";
}

function windsurfLocalCandidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".codeium", "usage.json"),
    path.join(home, ".windsurf", "usage.json"),
    path.join(home, "AppData", "Roaming", "Windsurf", "User", "globalStorage", "codeium.codeium", "usage.json"),
    path.join(
      home,
      "Library",
      "Application Support",
      "Windsurf",
      "User",
      "globalStorage",
      "codeium.codeium",
      "usage.json",
    ),
  ];
}

async function readWindsurfLocalUsage(): Promise<{ path: string; payload: unknown } | undefined> {
  for (const candidate of windsurfLocalCandidates()) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const payload = parseJsonObjectFromText(raw);
      if (payload) {
        return { path: candidate, payload };
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export function mapWindsurfUsage(payload: unknown) {
  const flexUsed = readFirstNumber(payload, ["flexUsed", "flex_used", "usedCredits", "creditsUsed", "usage"]);
  const flexLimit = readFirstNumber(payload, ["flexLimit", "flex_limit", "creditsLimit", "limit"]);
  const requestsUsed = readFirstNumber(payload, ["requestsUsed", "requests_used", "requestCount"]);
  const requestsLimit = readFirstNumber(payload, ["requestsLimit", "requests_limit"]);
  const resetAt = readFirstDate(payload, ["resetAt", "reset_at", "renewAt", "renew_at"]);
  const quotas = [];

  if (flexUsed !== undefined || flexLimit !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "windsurf-flex-credits",
        label: "Flex Credits",
        used: flexUsed,
        total: flexLimit,
        unit: "credits",
        resetAt,
      }),
    );
  }
  if (requestsUsed !== undefined || requestsLimit !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "windsurf-requests",
        label: "Requests",
        used: requestsUsed,
        total: requestsLimit,
        resetAt,
      }),
    );
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "windsurf-readable",
      label: "Windsurf Usage",
      remainingDisplay: "Windsurf data was found, but no known usage fields were present.",
      status: "unknown" as const,
    });
  }
  return quotas;
}

export async function fetchWindsurfSnapshot(options: WindsurfOptions = {}) {
  const local = await readWindsurfLocalUsage();
  if (local) {
    return buildSnapshot({
      provider: "windsurf",
      planLabel: readFirstString(local.payload, ["plan", "planName", "subscription"]) ?? "Local",
      quotas: mapWindsurfUsage(local.payload),
      endpoint: local.path,
      sourceLabel: "Windsurf local usage cache",
      rawPayload: local.payload,
      resetPolicy: "Windsurf usage is read from local cache when present, otherwise dashboard session endpoints.",
    });
  }

  const sourceMode = normalizeMode(options.cookieSourceMode);
  const resolved = await resolveCookieCandidates({
    manual: options.cookieHeader,
    cached: options.cachedCookieHeader,
    env: [process.env.WINDSURF_COOKIE_HEADER, process.env.WINDSURF_COOKIE],
    sourceMode,
    domains: ["windsurf.com", "codeium.com"],
  });
  if (resolved.candidates.length === 0) {
    throw new Error("No Windsurf local usage cache or session cookie found.");
  }

  const endpoints = options.usageUrl?.trim() ? [options.usageUrl.trim()] : DEFAULT_ENDPOINTS;
  let lastError: Error | undefined;
  for (const candidate of resolved.candidates) {
    for (const endpoint of endpoints) {
      try {
        const payload = await requestJson<unknown>(
          endpoint,
          {
            method: "GET",
            headers: {
              Cookie: candidate.header,
              Accept: "application/json",
              Referer: "https://windsurf.com/account",
            },
          },
          "Windsurf session cookie is invalid or expired.",
        );
        if (options.onCookieResolved) {
          await options.onCookieResolved(candidate.header, candidate.source);
        }
        return buildSnapshot({
          provider: "windsurf",
          planLabel: "Session",
          quotas: mapWindsurfUsage(payload),
          endpoint,
          sourceLabel: `Windsurf session cookie (${candidate.source})`,
          rawPayload: payload,
          resetPolicy: "Windsurf usage is read from local cache when present, otherwise dashboard session endpoints.",
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  throw lastError ?? new Error("Windsurf usage request failed.");
}
