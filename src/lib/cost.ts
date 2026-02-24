import { promises as fs } from "fs";
import { Dirent } from "fs";
import path from "path";

export interface LocalCostSummary {
  filesScanned: number;
  recordsScanned: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usdCost: number;
}

interface ScannerOptions {
  roots: string[];
  maxFiles?: number;
  maxAgeDays?: number;
}

function normalizeRoot(root: string): string | undefined {
  const trimmed = root.trim();
  return trimmed ? path.normalize(trimmed) : undefined;
}

async function collectJsonlFiles(roots: string[], maxFiles: number, maxAgeDays: number): Promise<string[]> {
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const files: Array<{ filePath: string; mtimeMs: number }> = [];

  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      let entries: Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) {
          continue;
        }

        try {
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            continue;
          }
          files.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
        } catch {
          continue;
        }
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, maxFiles).map((item) => item.filePath);
}

function maybeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

interface TokenCostTotals {
  input: number;
  output: number;
  cached: number;
  cost: number;
}

function accumulateFromObject(node: unknown, totals: TokenCostTotals): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      accumulateFromObject(child, totals);
    }
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const numeric = maybeNumber(value);
    const lower = key.toLowerCase();

    if (numeric !== undefined) {
      if (/(^|_)input_tokens$|^prompt_tokens$/.test(lower)) {
        totals.input += numeric;
      } else if (/(^|_)output_tokens$|^completion_tokens$/.test(lower)) {
        totals.output += numeric;
      } else if (/cache_.*tokens|cached_tokens/.test(lower)) {
        totals.cached += numeric;
      } else if (/cost_usd|total_cost_usd|usd_cost|costusd/.test(lower)) {
        totals.cost += numeric;
      }
    }

    if (typeof value === "object" && value !== null) {
      accumulateFromObject(value, totals);
    }
  }
}

export async function scanLocalCostSummary(options: ScannerOptions): Promise<LocalCostSummary | undefined> {
  const roots = options.roots.map(normalizeRoot).filter((value): value is string => !!value);
  if (roots.length === 0) {
    return undefined;
  }

  const maxFiles = options.maxFiles ?? 120;
  const maxAgeDays = options.maxAgeDays ?? 30;
  const files = await collectJsonlFiles(roots, maxFiles, maxAgeDays);
  if (files.length === 0) {
    return undefined;
  }

  const totals: TokenCostTotals = {
    input: 0,
    output: 0,
    cached: 0,
    cost: 0,
  };
  let recordsScanned = 0;

  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        recordsScanned += 1;
        accumulateFromObject(parsed, totals);
      } catch {
        continue;
      }
    }
  }

  return {
    filesScanned: files.length,
    recordsScanned,
    inputTokens: Math.round(totals.input),
    outputTokens: Math.round(totals.output),
    cachedTokens: Math.round(totals.cached),
    usdCost: Math.round(totals.cost * 10000) / 10000,
  };
}
