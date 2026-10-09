import { AppError } from "../../middleware/error.middleware";

export type AttendanceBreak = {
  note?: string | null;
  id: string; attendance_id: string; request_id: string;
  planned_start: string; planned_end: string; actual_start: string; actual_end: string | null;
  created_at: string; updated_at: string;
};
type Day = { check_in: string | null; check_out: string | null; scheduled_start?: string | null; scheduled_end?: string | null };
const ms = (value: string) => new Date(value).getTime();
const seconds = (start: string, end: string) => Math.max(0, Math.floor((ms(end) - ms(start)) / 1000));

// The first/final punches plus actual breaks reconstruct every work segment,
// including legacy attendance with no break rows. Planned return never closes a break.
export function attendanceActivity(day: Day | null, breaks: AttendanceBreak[] = [], now = new Date()) {
  const active = breaks.find(item => !item.actual_end) ?? null;
  const end = day?.check_out ?? now.toISOString();
  const sessions: { type: "WORK" | "BREAK"; start_time: string; end_time: string | null; duration_seconds: number }[] = [];
  let cursor = day?.check_in;
  for (const item of breaks) {
    if (cursor) sessions.push({ type: "WORK", start_time: cursor, end_time: item.actual_start, duration_seconds: seconds(cursor, item.actual_start) });
    sessions.push({ type: "BREAK", start_time: item.actual_start, end_time: item.actual_end, duration_seconds: seconds(item.actual_start, item.actual_end ?? end) });
    cursor = item.actual_end;
  }
  if (cursor) sessions.push({ type: "WORK", start_time: cursor, end_time: day?.check_out ?? null, duration_seconds: seconds(cursor, end) });
  return {
    current_status: !day?.check_in ? "NOT_CHECKED_IN" as const : day.check_out ? "CHECKED_OUT" as const : active ? "ON_BREAK" as const : "WORKING" as const,
    scheduled_start: day?.scheduled_start ?? null, scheduled_end: day?.scheduled_end ?? null,
    scheduled_seconds: day?.scheduled_start && day.scheduled_end ? seconds(day.scheduled_start, day.scheduled_end) : null,
    total_worked_seconds: sessions.filter(item => item.type === "WORK").reduce((sum, item) => sum + item.duration_seconds, 0),
    total_break_seconds: sessions.filter(item => item.type === "BREAK").reduce((sum, item) => sum + item.duration_seconds, 0),
    break_count: breaks.length, active_break: active, breaks, sessions,
  };
}

export function validateBreak(day: Day, breaks: AttendanceBreak[], from: unknown, to: unknown, now: Date) {
  const fail = (message: string): never => { throw new AppError(400, message, "INVALID_BREAK"); };
  if (!day.check_in || day.check_out) fail("A break requires a working attendance day.");
  if (breaks.some(item => !item.actual_end)) fail("You are already on break. Check in before starting another break.");
  const timestamp = (value: unknown): value is string => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(ms(value));
  if (!timestamp(from) || !timestamp(to)) fail("From and To must be valid timestamps with a timezone.");
  const start = ms(from as string), end = ms(to as string);
  if (end <= start || end <= now.getTime()) fail("Expected return must be later than From and the current time.");
  if (!day.scheduled_start || !day.scheduled_end) fail("A scheduled shift is required to take a break.");
  if (start < ms(day.scheduled_start!) || end > ms(day.scheduled_end!) || now.getTime() < ms(day.scheduled_start!) || now.getTime() >= ms(day.scheduled_end!)) fail("The break must be within your scheduled shift.");
  const lastCheckIn = breaks.length ? breaks[breaks.length - 1].actual_end! : day.check_in!;
  if (start < ms(lastCheckIn)) fail("From cannot be before your current check-in.");
  // From/To describe the planned period; actual_start is always stamped by the server at submission.
  if (breaks.some(item => start < ms(item.actual_end ?? item.planned_end) && end > ms(item.actual_start))) fail("Break periods cannot overlap.");
}
