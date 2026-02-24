const SENSITIVE_KEY_PATTERN = /(token|cookie|authorization|secret|password|api[-_]?key|session)/i;

function redactString(value: string): string {
  if (value.length <= 12) {
    return "[REDACTED]";
  }
  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

export function redactSensitive(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === "string") {
    if (input.length > 30 && /[A-Za-z0-9_\-.]{20,}/.test(input)) {
      return redactString(input);
    }
    return input;
  }

  if (typeof input !== "object") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((value) => redactSensitive(value));
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = typeof value === "string" ? redactString(value) : "[REDACTED]";
      continue;
    }
    output[key] = redactSensitive(value);
  }

  return output;
}
