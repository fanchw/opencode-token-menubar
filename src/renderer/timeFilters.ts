export type TimezoneMode = "local" | "utc";

export type QuickRange =
  | "today"
  | "week"
  | "month"
  | "15m"
  | "1h"
  | "6h"
  | "24h"
  | "7d"
  | "30d";

export interface ResolvedRange {
  start: string;
  end: string;
}

type CustomRangeResult =
  | { valid: true; start: string; end: string }
  | { valid: false; message: string };

type CalendarRange = "today" | "week" | "month";

const relativeDurations: Record<Exclude<QuickRange, "today" | "week" | "month">, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function resolveQuickRange(
  range: QuickRange,
  now: Date,
  timezone: TimezoneMode,
): ResolvedRange {
  if (range in relativeDurations) {
    const duration = relativeDurations[range as keyof typeof relativeDurations];
    return {
      start: new Date(now.getTime() - duration).toISOString(),
      end: now.toISOString(),
    };
  }

  const calendarRange = range as CalendarRange;
  const start = getCalendarStart(calendarRange, now, timezone);
  const end = getCalendarEnd(calendarRange, start, timezone);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function validateCustomRange(startValue: string, endValue: string): CustomRangeResult {
  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false, message: "Invalid time range." };
  }

  if (end.getTime() <= start.getTime()) {
    return { valid: false, message: "End time must be after start time." };
  }

  return {
    valid: true,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function formatTimeInZone(
  timestamp: string,
  timezone: TimezoneMode,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!options || Object.keys(options).length === 0) {
    return formatFullTimestamp(timestamp, timezone);
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone === "utc" ? "UTC" : undefined,
    ...options,
  }).format(new Date(timestamp));
}

function formatFullTimestamp(timestamp: string, timezone: TimezoneMode): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (timezone === "utc") {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getCalendarStart(
  range: CalendarRange,
  now: Date,
  timezone: TimezoneMode,
): Date {
  if (timezone === "utc") {
    if (range === "today") {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }

    if (range === "week") {
      const dayOffset = getDaysSinceMonday(now.getUTCDay());
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset));
    }

    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === "week") {
    const dayOffset = getDaysSinceMonday(now.getDay());
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
  }

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getCalendarEnd(
  range: CalendarRange,
  start: Date,
  timezone: TimezoneMode,
): Date {
  const days = range === "today" ? 1 : 7;

  if (range === "month") {
    return timezone === "utc"
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
      : new Date(start.getFullYear(), start.getMonth() + 1, 1);
  }

  if (timezone === "local") {
    const end = new Date(start);
    end.setDate(start.getDate() + (range === "today" ? 1 : 7));
    return end;
  }

  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

function getDaysSinceMonday(day: number): number {
  return (day + 6) % 7;
}
