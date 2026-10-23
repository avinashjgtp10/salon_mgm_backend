import { AppError } from "../../../middleware/error.middleware";

// Turns "last month" / "this week" into exact dates in the SALON's own timezone, so the AI never does date maths
// (LLMs are unreliable at it) and the figures line up with what the reports show for the same dates.

export const PERIODS = [
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "last_7_days", "last_30_days", "this_year", "last_year", "custom",
] as const;
export type Period = (typeof PERIODS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 800; // about two years — enough for year-on-year, bounded so one question can't scan everything

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000));

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(tz: string, now = new Date()): string {
    try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    } catch {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    }
}

export type ResolvedPeriod = { period: Period; label: string; start_date: string; end_date: string };

export function resolvePeriod(period: unknown, tz: string, customStart?: unknown, customEnd?: unknown, now = new Date()): ResolvedPeriod {
    const p = (PERIODS as readonly string[]).includes(String(period)) ? (String(period) as Period) : null;
    if (!p) throw new AppError(400, `period must be one of: ${PERIODS.join(", ")}`, "BAD_PERIOD");

    const today = todayIn(tz, now);
    const [y, m] = today.split("-").map(Number);
    const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
    const monthEnd = (yy: number, mm: number) => addDays(monthStart(mm === 12 ? yy + 1 : yy, mm === 12 ? 1 : mm + 1), -1);
    // Weeks run Monday–Sunday.
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
    const weekStart = addDays(today, -dow);

    let start: string, end: string, label: string;
    switch (p) {
        case "today": start = end = today; label = "today"; break;
        case "yesterday": start = end = addDays(today, -1); label = "yesterday"; break;
        case "this_week": start = weekStart; end = today; label = "this week (Mon–today)"; break;
        case "last_week": start = addDays(weekStart, -7); end = addDays(weekStart, -1); label = "last week (Mon–Sun)"; break;
        case "this_month": start = monthStart(y, m); end = today; label = "this month so far"; break;
        case "last_month": {
            const lm = m === 1 ? 12 : m - 1, ly = m === 1 ? y - 1 : y;
            start = monthStart(ly, lm); end = monthEnd(ly, lm); label = "last month"; break;
        }
        case "last_7_days": start = addDays(today, -6); end = today; label = "the last 7 days"; break;
        case "last_30_days": start = addDays(today, -29); end = today; label = "the last 30 days"; break;
        case "this_year": start = `${y}-01-01`; end = today; label = "this year so far"; break;
        case "last_year": start = `${y - 1}-01-01`; end = `${y - 1}-12-31`; label = "last year"; break;
        case "custom": {
            if (typeof customStart !== "string" || typeof customEnd !== "string" || !DATE_RE.test(customStart) || !DATE_RE.test(customEnd)) {
                throw new AppError(400, "For a custom period give start_date and end_date as YYYY-MM-DD.", "BAD_PERIOD");
            }
            start = customStart; end = customEnd; label = `${start} to ${end}`; break;
        }
    }
    if (end < start) throw new AppError(400, "The end date is before the start date.", "BAD_PERIOD");
    const days = (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000 + 1;
    if (days > MAX_RANGE_DAYS) throw new AppError(400, "That date range is too long — please ask for two years or less.", "BAD_PERIOD");
    return { period: p, label, start_date: start, end_date: end };
}
