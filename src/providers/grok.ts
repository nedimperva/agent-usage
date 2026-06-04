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
  runCommandText,
} from "./provider-helpers";

type CookieMode = "auto" | "manual";

interface GrokOptions {
  cookieHeader?: string;
  cookieSourceMode?: CookieMode;
  cachedCookieHeader?: string;
  usageUrl?: string;
  onCookieResolved?: (cookieHeader: string, source: string) => void | Promise<void>;
}

const DEFAULT_ENDPOINTS = ["https://grok.com/rest/billing", "https://grok.com/rest/rate-limits"];

function normalizeMode(value?: string): CookieMode {
  return value?.toLowerCase() === "manual" ? "manual" : "auto";
}

async function tryGrokCli(): Promise<{ source: string; payload: unknown; text: string } | undefined> {
  const binary = process.env.GROK_CLI_PATH?.trim() || "grok";
  const attempts = [
    ["billing", "--json"],
    ["agent", "billing", "--json"],
  ];
  for (const args of attempts) {
    try {
      const text = await runCommandText(binary, args, 10000);
      return { source: `${binary} ${args.join(" ")}`, payload: parseJsonObjectFromText(text), text };
    } catch {
      continue;
    }
  }
  return undefined;
}

async function readGrokLocalSignals(): Promise<{ source: string; payload: unknown } | undefined> {
  const root = path.join(os.homedir(), ".grok", "sessions");
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return undefined;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let filesScanned = 0;
  for (const entry of entries.slice(-50)) {
    const target = path.join(root, entry, "signals.json");
    try {
      const parsed = JSON.parse(await fs.readFile(target, "utf8")) as unknown;
      inputTokens += readFirstNumber(parsed, ["input_tokens", "inputTokens", "prompt_tokens"]) ?? 0;
      outputTokens += readFirstNumber(parsed, ["output_tokens", "outputTokens", "completion_tokens"]) ?? 0;
      filesScanned += 1;
    } catch {
      continue;
    }
  }

  if (filesScanned === 0) {
    return undefined;
  }
  return { source: root, payload: { inputTokens, outputTokens, filesScanned } };
}

export function mapGrokUsage(payload: unknown, fallbackText?: string) {
  const used = readFirstNumber(payload, ["used", "usage", "creditsUsed", "requestsUsed", "percentUsed"]);
  const limit = readFirstNumber(payload, ["limit", "quota", "creditsLimit", "requestsLimit"]);
  const inputTokens = readFirstNumber(payload, ["inputTokens", "input_tokens", "prompt_tokens"]);
  const outputTokens = readFirstNumber(payload, ["outputTokens", "output_tokens", "completion_tokens"]);
  const resetAt = readFirstDate(payload, ["resetAt", "reset_at", "nextResetAt"]);
  const quotas = [];

  if (used !== undefined || limit !== undefined) {
    quotas.push(buildCountQuota({ id: "grok-usage", label: "Usage", used, total: limit, resetAt }));
  }
  if (inputTokens !== undefined || outputTokens !== undefined) {
    quotas.push(
      buildCountQuota({
        id: "grok-local-tokens",
        label: "Local Tokens",
        used: (inputTokens ?? 0) + (outputTokens ?? 0),
        unit: "tokens",
      }),
    );
  }
  if (quotas.length === 0) {
    quotas.push({
      id: "grok-readable",
      label: "Grok Usage",
      remainingDisplay:
        fallbackText?.trim().slice(0, 180) || "Grok returned data, but no known quota fields were present.",
      status: "unknown" as const,
    });
  }
  return quotas;
}

export async function fetchGrokSnapshot(options: GrokOptions = {}) {
  const cli = await tryGrokCli();
  if (cli) {
    return buildSnapshot({
      provider: "grok",
      planLabel: readFirstString(cli.payload, ["plan", "planName", "subscription"]) ?? "CLI",
      quotas: mapGrokUsage(cli.payload, cli.text),
      endpoint: cli.source,
      sourceLabel: "Grok CLI",
      rawPayload: cli.payload ?? { output: cli.text },
      resetPolicy: "Grok usage prefers CLI billing output, then dashboard cookies, then local token signals.",
    });
  }

  const sourceMode = normalizeMode(options.cookieSourceMode);
  const resolved = await resolveCookieCandidates({
    manual: options.cookieHeader,
    cached: options.cachedCookieHeader,
    env: [process.env.GROK_COOKIE_HEADER, process.env.GROK_COOKIE],
    sourceMode,
    domains: ["grok.com", "x.ai"],
  });
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
              Referer: "https://grok.com",
            },
          },
          "Grok session cookie is invalid or expired.",
        );
        if (options.onCookieResolved) {
          await options.onCookieResolved(candidate.header, candidate.source);
        }
        return buildSnapshot({
          provider: "grok",
          planLabel: "Session",
          quotas: mapGrokUsage(payload),
          endpoint,
          sourceLabel: `Grok dashboard cookie (${candidate.source})`,
          rawPayload: payload,
          resetPolicy: "Grok usage prefers CLI billing output, then dashboard cookies, then local token signals.",
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  const local = await readGrokLocalSignals();
  if (local) {
    return buildSnapshot({
      provider: "grok",
      planLabel: "Local",
      quotas: mapGrokUsage(local.payload),
      endpoint: local.source,
      sourceLabel: "Grok local session signals",
      rawPayload: local.payload,
      resetPolicy: "Local token signals are estimates when live Grok billing is unavailable.",
    });
  }

  throw lastError ?? new Error("No Grok CLI, dashboard cookie, or local usage signals found.");
}
