import { ForgeError } from "../core/types.js";

/**
 * Minimal 5-field cron (minute hour day-of-month month day-of-week).
 * Supports star, N, N-M, star/N steps, and comma lists. UTC fields.
 */
export interface CronParts {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  raw: string;
}

export function parseCronExpression(expr: string): CronParts {
  const trimmed = expr.trim().replace(/\s+/g, " ");
  const parts = trimmed.split(" ");
  if (parts.length !== 5) {
    throw new ForgeError(
      `Cron must have 5 fields (got ${parts.length}): ${expr}`,
      "INVALID_CRON",
    );
  }
  return {
    minute: parseField(parts[0]!, 0, 59),
    hour: parseField(parts[1]!, 0, 23),
    dayOfMonth: parseField(parts[2]!, 1, 31),
    month: parseField(parts[3]!, 1, 12),
    dayOfWeek: parseField(parts[4]!, 0, 6),
    raw: trimmed,
  };
}

function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const piece of field.split(",")) {
    const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(piece);
    if (!stepMatch) {
      throw new ForgeError(`Invalid cron field: ${field}`, "INVALID_CRON");
    }
    const base = stepMatch[1]!;
    const step = stepMatch[2] ? Number(stepMatch[2]) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new ForgeError(`Invalid cron step in: ${field}`, "INVALID_CRON");
    }
    let start = min;
    let end = max;
    if (base !== "*") {
      if (base.includes("-")) {
        const [a, b] = base.split("-").map(Number);
        start = a!;
        end = b!;
      } else {
        start = Number(base);
        end = start;
      }
    }
    if (start < min || end > max || start > end) {
      throw new ForgeError(`Cron field out of range: ${field}`, "INVALID_CRON");
    }
    for (let i = start; i <= end; i += step) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** Next fire time strictly after `from` (UTC). */
export function nextCronOccurrence(expr: string, from = new Date()): Date {
  const parts = parseCronExpression(expr);
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    const month = cursor.getUTCMonth() + 1;
    const dom = cursor.getUTCDate();
    const dow = cursor.getUTCDay();
    const hour = cursor.getUTCHours();
    const minute = cursor.getUTCMinutes();

    if (!parts.month.includes(month)) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!parts.dayOfMonth.includes(dom) || !parts.dayOfWeek.includes(dow)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!parts.hour.includes(hour)) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parts.minute.includes(minute)) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return cursor;
  }
  throw new ForgeError(`No cron match within a year for: ${parts.raw}`, "INVALID_CRON");
}

/** Rough interval hint for UIs when only cron is set. */
export function estimateCronEveryMs(expr: string): number {
  const parts = parseCronExpression(expr);
  if (parts.minute.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < parts.minute.length; i++) {
      diffs.push(parts.minute[i]! - parts.minute[i - 1]!);
    }
    if (diffs.length) return Math.min(...diffs) * 60_000;
  }
  if (parts.hour.length >= 2 && parts.minute.length === 1) {
    return 60 * 60 * 1000;
  }
  if (parts.hour.length === 24 && parts.minute.length === 1) {
    return 60 * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
}
