export function formatResetDate(value?: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatRelativeTimestamp(value?: string, referenceTimeMs = Date.now()): string {
  if (!value) {
    return "never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "never";
  }

  const deltaMs = date.getTime() - referenceTimeMs;
  const deltaMinutes = Math.round(deltaMs / (1000 * 60));
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  if (Math.abs(deltaMinutes) < 60) {
    return rtf.format(deltaMinutes, "minute");
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 48) {
    return rtf.format(deltaHours, "hour");
  }

  const deltaDays = Math.round(deltaHours / 24);
  return rtf.format(deltaDays, "day");
}

export function formatRemainingDaysHours(value?: string, referenceTimeMs = Date.now()): string {
  if (!value) {
    return "";
  }

  const targetMs = Date.parse(value);
  if (Number.isNaN(targetMs)) {
    return "";
  }

  const deltaMs = targetMs - referenceTimeMs;
  if (deltaMs <= 0) {
    return "0d 0h";
  }

  const totalHours = Math.floor(deltaMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}
