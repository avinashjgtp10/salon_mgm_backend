import { DEFAULT_SALON_TIMEZONE } from "../../config/salonTimezone";

export type Shift = { start_time: string | null; end_time: string | null; is_available: boolean };

// The salon's local calendar date (YYYY-MM-DD) at the given instant.
export function salonDate(now: Date, timeZone = DEFAULT_SALON_TIMEZONE): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}

// Milliseconds the zone is ahead of UTC at the given instant.
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant)).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// The instant at which a zone's wall clock reads `date` `hhmm`.
export function zonedInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  let t = wall - zoneOffsetMs(wall, timeZone);
  t = wall - zoneOffsetMs(t, timeZone); // second pass settles offsets that change near the guess (DST)
  return new Date(t);
}

export function shiftWindow(date: string, shift: Shift | null, timeZone = DEFAULT_SALON_TIMEZONE) {
  if (!shift?.is_available || !shift.start_time || !shift.end_time) return null;
  const start = zonedInstant(date, shift.start_time.slice(0, 5), timeZone);
  let end = zonedInstant(date, shift.end_time.slice(0, 5), timeZone);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end, reminderAt: new Date(start.getTime() + 15 * 60000) };
}
