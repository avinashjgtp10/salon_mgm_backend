import { AppError } from "../../middleware/error.middleware";
import type {
  ReportPeriod,
  RevenueCardItem,
  RevenueKPI,
  RevenueServiceItem,
  RevenueTrendPoint,
} from "./reports.types";

type TrendGranularity = "day" | "week" | "month";

export interface RevenueRange {
  period: ReportPeriod;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  days: number;
  granularity: TrendGranularity;
}

export interface RevenueTrendBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

export interface RevenueTrendRow {
  transactionAt: string | Date;
  amount: number;
}

export interface RevenueCalendarWindow {
  timeZone: string;
  todayStart: Date;
  tomorrowStart: Date;
  yesterdayStart: Date;
  monthStart: Date;
  nextMonthStart: Date;
  previousMonthStart: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENCY_FORMATTER = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
  style: "currency",
  currency: "INR",
});

const SERVICE_COLORS = [
  "#111827",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];

const PERIOD_ALIASES: Record<string, ReportPeriod> = {
  "1d": "today",
  "7d": "7d",
  "15d": "15d",
  "30d": "30d",
  "60d": "60d",
  "90d": "90d",
  "12m": "12m",
  today: "today",
};

const DEFAULT_REPORT_TIMEZONE = "Asia/Kolkata";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatKey(date: Date): string {
  return date.toISOString();
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}

function shiftCalendarDate(year: number, month: number, day: number, offsetDays: number): Date {
  return new Date(Date.UTC(year, month - 1, day + offsetDays));
}

function formatBucketLabel(
  start: Date,
  end: Date,
  granularity: TrendGranularity,
  range: RevenueRange,
): string {
  if (range.period === "today" && granularity === "day") {
    return "Today";
  }

  if (granularity === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
    }).format(start);
  }

  if (granularity === "week") {
    const startLabel = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(start);
    const inclusiveEnd = addUtcDays(end, -1);
    const endLabel = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: start.getUTCMonth() === inclusiveEnd.getUTCMonth() ? undefined : "short",
      timeZone: "UTC",
    }).format(inclusiveEnd);
    return `${startLabel} - ${endLabel}`;
  }

  if (range.days <= 7) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }).format(start);
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(start);
}

function parseDateInput(value: string, field: "from" | "to"): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, `${field} must be a valid YYYY-MM-DD date`, "VALIDATION_ERROR");
  }
  return parsed;
}

function resolvePeriodDays(period: ReportPeriod): number {
  switch (period) {
    case "today":
      return 1;
    case "7d":
      return 7;
    case "15d":
      return 15;
    case "30d":
      return 30;
    case "60d":
      return 60;
    case "90d":
      return 90;
    case "12m":
      return 365;
    default:
      return 30;
  }
}

function resolveGranularity(days: number, period: ReportPeriod): TrendGranularity {
  if (period === "12m") return "month";
  if (days > 60) return "week";
  return "day";
}

export function normalizeRevenuePeriod(period?: string): ReportPeriod {
  return PERIOD_ALIASES[(period ?? "30d").trim().toLowerCase()] ?? "30d";
}

export function getRevenueReportTimeZone(): string {
  return DEFAULT_REPORT_TIMEZONE;
}

export function getRevenueCalendarWindow(referenceDate = new Date(), timeZone = getRevenueReportTimeZone()): RevenueCalendarWindow {
  const current = getTimeZoneParts(referenceDate, timeZone);
  const todayCalendar = shiftCalendarDate(current.year, current.month, current.day, 0);
  const tomorrowCalendar = shiftCalendarDate(current.year, current.month, current.day, 1);
  const yesterdayCalendar = shiftCalendarDate(current.year, current.month, current.day, -1);

  const todayYear = todayCalendar.getUTCFullYear();
  const todayMonth = todayCalendar.getUTCMonth() + 1;
  const todayDay = todayCalendar.getUTCDate();

  const tomorrowYear = tomorrowCalendar.getUTCFullYear();
  const tomorrowMonth = tomorrowCalendar.getUTCMonth() + 1;
  const tomorrowDay = tomorrowCalendar.getUTCDate();

  const yesterdayYear = yesterdayCalendar.getUTCFullYear();
  const yesterdayMonth = yesterdayCalendar.getUTCMonth() + 1;
  const yesterdayDay = yesterdayCalendar.getUTCDate();

  const monthStart = zonedDateTimeToUtc(todayYear, todayMonth, 1, 0, 0, 0, timeZone);
  const nextMonthCalendar = new Date(Date.UTC(todayYear, todayMonth, 1));
  const previousMonthCalendar = new Date(Date.UTC(todayYear, todayMonth - 2, 1));

  return {
    timeZone,
    todayStart: zonedDateTimeToUtc(todayYear, todayMonth, todayDay, 0, 0, 0, timeZone),
    tomorrowStart: zonedDateTimeToUtc(tomorrowYear, tomorrowMonth, tomorrowDay, 0, 0, 0, timeZone),
    yesterdayStart: zonedDateTimeToUtc(yesterdayYear, yesterdayMonth, yesterdayDay, 0, 0, 0, timeZone),
    monthStart,
    nextMonthStart: zonedDateTimeToUtc(
      nextMonthCalendar.getUTCFullYear(),
      nextMonthCalendar.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      timeZone,
    ),
    previousMonthStart: zonedDateTimeToUtc(
      previousMonthCalendar.getUTCFullYear(),
      previousMonthCalendar.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      timeZone,
    ),
  };
}

export function resolveRevenueDateRange(
  rawPeriod?: string,
  from?: string,
  to?: string,
): RevenueRange {
  if ((from && !to) || (!from && to)) {
    throw new AppError(400, "from and to must be provided together", "VALIDATION_ERROR");
  }

  if (from && to) {
    const start = startOfUtcDay(parseDateInput(from, "from"));
    const end = addUtcDays(startOfUtcDay(parseDateInput(to, "to")), 1);

    if (end <= start) {
      throw new AppError(400, "to must be greater than or equal to from", "VALIDATION_ERROR");
    }

    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
    return {
      period: "custom",
      start,
      end,
      previousStart: addUtcDays(start, -days),
      previousEnd: start,
      days,
      granularity: resolveGranularity(days, "custom"),
    };
  }

  const period = normalizeRevenuePeriod(rawPeriod);
  const todayStart = startOfUtcDay(new Date());
  const todayEnd = addUtcDays(todayStart, 1);

  if (period === "today") {
    return {
      period,
      start: todayStart,
      end: todayEnd,
      previousStart: addUtcDays(todayStart, -1),
      previousEnd: todayStart,
      days: 1,
      granularity: "day",
    };
  }

  if (period === "12m") {
    const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1));
    const start = addUtcMonths(monthStart, -11);
    const end = addUtcMonths(monthStart, 1);
    return {
      period,
      start,
      end,
      previousStart: addUtcMonths(start, -12),
      previousEnd: start,
      days: Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS)),
      granularity: "month",
    };
  }

  const days = resolvePeriodDays(period);
  const start = addUtcDays(todayStart, -(days - 1));
  return {
    period,
    start,
    end: todayEnd,
    previousStart: addUtcDays(start, -days),
    previousEnd: start,
    days,
    granularity: resolveGranularity(days, period),
  };
}

export function buildRevenueTrendBuckets(range: RevenueRange): RevenueTrendBucket[] {
  const buckets: RevenueTrendBucket[] = [];

  if (range.granularity === "month") {
    let cursor = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
    while (cursor < range.end) {
      const next = addUtcMonths(cursor, 1);
      buckets.push({
        key: formatKey(cursor),
        label: formatBucketLabel(cursor, next, "month", range),
        start: cursor,
        end: next,
      });
      cursor = next;
    }
    return buckets;
  }

  if (range.granularity === "week") {
    let cursor = range.start;
    while (cursor < range.end) {
      const next = new Date(Math.min(addUtcDays(cursor, 7).getTime(), range.end.getTime()));
      buckets.push({
        key: formatKey(cursor),
        label: formatBucketLabel(cursor, next, "week", range),
        start: cursor,
        end: next,
      });
      cursor = next;
    }
    return buckets;
  }

  let cursor = range.start;
  while (cursor < range.end) {
    const next = addUtcDays(cursor, 1);
    buckets.push({
      key: formatKey(cursor),
      label: formatBucketLabel(cursor, next, "day", range),
      start: cursor,
      end: next,
    });
    cursor = next;
  }
  return buckets;
}

export function buildPreviousRevenueTrendBuckets(
  range: RevenueRange,
  currentBuckets: RevenueTrendBucket[],
): RevenueTrendBucket[] {
  if (range.period === "12m") {
    return currentBuckets.map((bucket) => {
      const start = addUtcMonths(bucket.start, -12);
      const end = addUtcMonths(bucket.end, -12);
      return {
        key: bucket.key,
        label: bucket.label,
        start,
        end,
      };
    });
  }

  const offsetMs = range.start.getTime() - range.previousStart.getTime();
  return currentBuckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    start: new Date(bucket.start.getTime() - offsetMs),
    end: new Date(bucket.end.getTime() - offsetMs),
  }));
}

export function aggregateRevenueRowsByBuckets(
  rows: RevenueTrendRow[],
  buckets: RevenueTrendBucket[],
): Map<string, number> {
  const totals = new Map<string, number>(buckets.map((bucket) => [bucket.key, 0]));

  for (const row of rows) {
    const timestamp = new Date(row.transactionAt);
    if (Number.isNaN(timestamp.getTime())) continue;

    const bucket = buckets.find((candidate) =>
      timestamp.getTime() >= candidate.start.getTime()
      && timestamp.getTime() < candidate.end.getTime(),
    );

    if (!bucket) continue;
    totals.set(bucket.key, round2((totals.get(bucket.key) ?? 0) + row.amount));
  }

  return totals;
}

export function buildTrendPoints(
  buckets: RevenueTrendBucket[],
  currentMap: Map<string, number>,
  previousMap: Map<string, number>,
): RevenueTrendPoint[] {
  return buckets.map((bucket) => {
    const revenue = round2(currentMap.get(bucket.key) ?? 0);
    const prev = round2(previousMap.get(bucket.key) ?? 0);

    return {
      label: bucket.label,
      revenue,
      prev,
      target: round2(prev > 0 ? prev * 1.1 : 0),
    };
  });
}

export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return round1(((current - previous) / previous) * 100);
}

export function calculateRevenueKpi(params: {
  currentRangeRevenue: number;
  previousRangeRevenue: number;
  totalTransactions: number;
  previousTransactions: number;
  currentMonthRevenue: number;
  previousMonthRevenue: number;
  todayRevenue: number;
  yesterdayRevenue: number;
  days: number;
}): RevenueKPI {
  const avgDailyRevenue = round2(params.currentRangeRevenue / Math.max(params.days, 1));
  const previousAvgDailyRevenue = round2(params.previousRangeRevenue / Math.max(params.days, 1));

  return {
    currentMonthRevenue: round2(params.currentMonthRevenue),
    todayRevenue: round2(params.todayRevenue),
    yesterdayRevenue: round2(params.yesterdayRevenue),
    avgDailyRevenue,
    totalTransactions: params.totalTransactions,
    changes: {
      currentMonthRevenue: percentChange(params.currentMonthRevenue, params.previousMonthRevenue),
      todayRevenue: percentChange(params.todayRevenue, params.yesterdayRevenue),
      avgDailyRevenue: percentChange(avgDailyRevenue, previousAvgDailyRevenue),
      totalTransactions: percentChange(params.totalTransactions, params.previousTransactions),
    },
  };
}

export function assignRevenueServiceColors(services: Omit<RevenueServiceItem, "color">[]): RevenueServiceItem[] {
  return services.map((service, index) => ({
    ...service,
    color: SERVICE_COLORS[index % SERVICE_COLORS.length],
  }));
}

export function formatRevenueCards(kpi: RevenueKPI): RevenueCardItem[] {
  const toCard = (
    label: string,
    value: string,
    changeValue: number,
    color: string,
  ): RevenueCardItem => ({
    label,
    value,
    change: `${changeValue >= 0 ? "+" : ""}${round1(changeValue)}%`,
    up: changeValue >= 0,
    color,
  });

  return [
    toCard(
      "Current Month Revenue",
      CURRENCY_FORMATTER.format(kpi.currentMonthRevenue),
      kpi.changes.currentMonthRevenue,
      "#10b981",
    ),
    toCard(
      "Today's Revenue",
      CURRENCY_FORMATTER.format(kpi.todayRevenue),
      kpi.changes.todayRevenue,
      "#3b82f6",
    ),
    toCard(
      "Average Daily Revenue",
      CURRENCY_FORMATTER.format(kpi.avgDailyRevenue),
      kpi.changes.avgDailyRevenue,
      "#8b5cf6",
    ),
    toCard(
      "Total Transactions",
      String(kpi.totalTransactions),
      kpi.changes.totalTransactions,
      "#f59e0b",
    ),
  ];
}
