import pool from "../../config/database";
import type { PoolClient } from "pg";
import { getIO, salonRoom, salonStaffRoom } from "../../config/socket";
import { attendanceActivity, validateBreak, type AttendanceBreak } from "./attendance.activity";
import type { Attendance } from "./attendance.types";
import { AppError } from "../../middleware/error.middleware";
import { ownStaffId } from "../notifications/staffNotificationScope";
import { attendanceRepository } from "./attendance.repository";
import { notifyAttendanceBreak, notifyAttendancePunch } from "./attendance.service";
import { istDate, shiftWindow, type Shift } from "./staffAttendance.rules";

export async function staffAttendanceState(userId: string, salonId: string, now = new Date()) {
  const staffId = await ownStaffId(userId, salonId);
  if (!staffId) throw new AppError(403, "Your account is not linked to an active staff member.", "STAFF_NOT_LINKED");
  let date = istDate(now);
  const yesterday = istDate(new Date(now.getTime() - 86400000));
  async function schedule(day: string): Promise<Shift | null> {
    const { rows } = await pool.query<Shift>(
      `SELECT start_time::text, end_time::text, is_available FROM staff_schedules
       WHERE staff_id = $1 AND (date = $2::date OR (date IS NULL AND day_of_week = EXTRACT(DOW FROM $2::date)))
       ORDER BY date NULLS LAST LIMIT 1`, [staffId, day]);
    return rows[0] ?? null;
  }
  const [todayShift, priorShift] = await Promise.all([schedule(date), schedule(yesterday)]);
  let shift = todayShift;
  let window = shiftWindow(date, shift);
  const priorWindow = shiftWindow(yesterday, priorShift);
  if (priorWindow && now >= priorWindow.start && now < priorWindow.end) {
    date = yesterday; shift = priorShift; window = priorWindow;
  }
  const { rows: open } = await pool.query(`SELECT date::text FROM attendance a WHERE salon_id = $1 AND staff_id = $2 AND check_in IS NOT NULL AND check_out IS NULL AND (date >= $3::date OR EXISTS (SELECT 1 FROM attendance_breaks b WHERE b.attendance_id = a.id AND b.actual_end IS NULL)) ORDER BY date LIMIT 1`, [salonId, staffId, yesterday]);
  if (open[0]) { date = open[0].date; window = shiftWindow(date, await schedule(date)); }
  const record = await attendanceRepository.findByStaffAndDate(staffId, date);
  const activity = attendanceActivity(record, record?.breaks ?? [], now);
  return {
    staff_id: staffId, date, server_time: now.toISOString(),
    shift_start: record?.scheduled_start ?? window?.start.toISOString() ?? null, shift_end: record?.scheduled_end ?? window?.end.toISOString() ?? null,
    reminder_at: window?.reminderAt.toISOString() ?? null,
    ...activity,
    can_check_in: activity.current_status === "NOT_CHECKED_IN" || activity.current_status === "ON_BREAK",
    blocked_reason: activity.current_status === "CHECKED_OUT" ? "Your shift is complete." : null,
    checked_in: Boolean(record?.check_in), record: record ?? null,
  };
}

// Serialize transitions, including the first punch when no attendance row exists.
// afterCommit starts owner notifications as soon as the punch is saved, so the
// push does not also wait for the state reload below.
async function transition(userId: string, salonId: string, now: Date, action: (client: PoolClient, state: Awaited<ReturnType<typeof staffAttendanceState>>, record: Attendance | null, breaks: AttendanceBreak[]) => Promise<void>, afterCommit?: () => void) {
  const staffId = await ownStaffId(userId, salonId);
  if (!staffId) throw new AppError(403, "Staff profile not found", "STAFF_NOT_LINKED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [salonId + ":" + staffId]);
    const state = await staffAttendanceState(userId, salonId, now);
    const { rows } = await client.query<Attendance>("SELECT * FROM attendance WHERE salon_id = $1 AND staff_id = $2 AND date = $3::date FOR UPDATE", [salonId, staffId, state.date]);
    const record = rows[0] ?? null;
    const breaks = record ? (await client.query<AttendanceBreak>("SELECT * FROM attendance_breaks WHERE attendance_id = $1 ORDER BY actual_start", [record.id])).rows : [];
    await action(client, state, record, breaks);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
  afterCommit?.();
  // Invalidation only: no staff data is sent through the existing salon socket.
  try { getIO().to([salonRoom(salonId), salonStaffRoom(salonId)]).emit("attendance:updated", {}); } catch { /* Socket not initialized in tests. */ }
  return staffAttendanceState(userId, salonId, now);
}

export async function staffSelfCheckIn(userId: string, salonId: string, now = new Date(), location: string | null = null) {
  let resumed: { record: Attendance; brk: AttendanceBreak } | null = null;
  const next = await transition(userId, salonId, now, async (client, state, record, breaks) => {
    if (record?.check_out) throw new AppError(409, "This attendance day is complete.", "ALREADY_CHECKED_OUT");
    const active = breaks.find(item => !item.actual_end);
    if (active) {
      if (now <= new Date(active.actual_start)) throw new AppError(400, "Return must be after break start.", "INVALID_RETURN");
      await client.query("UPDATE attendance_breaks SET actual_end = $2, updated_at = NOW() WHERE id = $1", [active.id, now.toISOString()]);
      resumed = { record: record!, brk: { ...active, actual_end: now.toISOString() } };
    } else {
      if (record?.check_in) throw new AppError(409, "You are already working.", "ALREADY_CHECKED_IN");
      await client.query(`INSERT INTO attendance (salon_id, staff_id, date, check_in, status, source, check_in_location, scheduled_start, scheduled_end)
        VALUES ($1,$2,$3::date,$4,'present','manual',$5,$6,$7)
        ON CONFLICT (salon_id,staff_id,date) DO UPDATE SET check_in = EXCLUDED.check_in,
        check_in_location = EXCLUDED.check_in_location, scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end, updated_at = NOW()`,
        [salonId, state.staff_id, state.date, now.toISOString(), location, state.shift_start, state.shift_end]);
    }
    if (record) await client.query("UPDATE attendance SET updated_at = NOW() WHERE id = $1", [record.id]);
  }, () => { if (resumed) void notifyAttendanceBreak(resumed.record, resumed.brk, "end"); });
  if (!resumed && next.record) void notifyAttendancePunch(next.record, "in");
  return next;
}

export async function staffSelfStartBreak(userId: string, salonId: string, body: { from?: unknown; to?: unknown; request_id?: unknown; note?: unknown }, now = new Date()) {
  if (typeof body.request_id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(body.request_id)) throw new AppError(400, "A valid request_id is required.", "INVALID_REQUEST_ID");
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500)) throw new AppError(400, "Note must be text of at most 500 characters.", "INVALID_NOTE");
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  let started: { record: Attendance; brk: AttendanceBreak } | null = null;
  return transition(userId, salonId, now, async (client, state, record, breaks) => {
    if (!record?.check_in) throw new AppError(400, "Check in before taking a break.", "NOT_CHECKED_IN");
    const previous = breaks.find(item => item.request_id === body.request_id);
    if (previous) {
      if ((previous.note ?? null) !== note) throw new AppError(409, "Request ID was already used for a different note.", "DUPLICATE_REQUEST");
      if (new Date(previous.planned_start).getTime() !== new Date(String(body.from)).getTime() || new Date(previous.planned_end).getTime() !== new Date(String(body.to)).getTime()) throw new AppError(409, "Request ID was already used for different times.", "DUPLICATE_REQUEST");
      // Retry: re-notifying is safe because notifications deduplicate on the break id.
      started = { record, brk: previous };
      return;
    }
    const day = { ...record, scheduled_start: record.scheduled_start ?? state.shift_start, scheduled_end: record.scheduled_end ?? state.shift_end };
    validateBreak(day, breaks, body.from, body.to, now);
    if (!record.scheduled_start) await client.query("UPDATE attendance SET scheduled_start = $2, scheduled_end = $3 WHERE id = $1", [record.id, day.scheduled_start, day.scheduled_end]);
    started = { record, brk: (await client.query<AttendanceBreak>(`INSERT INTO attendance_breaks (attendance_id,request_id,planned_start,planned_end,actual_start,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [record.id, body.request_id, body.from, body.to, now.toISOString(), note])).rows[0] };
    await client.query("UPDATE attendance SET updated_at = NOW() WHERE id = $1", [record.id]);
  }, () => { if (started) void notifyAttendanceBreak(started.record, started.brk, "start"); });
}

export async function staffSelfCheckOut(userId: string, salonId: string, now = new Date(), location: string | null = null) {
  const next = await transition(userId, salonId, now, async (client, _state, record, breaks) => {
    if (!record?.check_in) throw new AppError(400, "You have not checked in.", "NOT_CHECKED_IN");
    if (record.check_out) throw new AppError(409, "This attendance day is complete.", "ALREADY_CHECKED_OUT");
    if (breaks.some(item => !item.actual_end)) throw new AppError(409, "Check in from your break before final checkout.", "ON_BREAK");
    const last = breaks.length ? breaks[breaks.length - 1].actual_end! : record.check_in;
    if (now <= new Date(last)) throw new AppError(400, "Checkout must be after your current check-in.", "INVALID_CHECKOUT");
    const activity = attendanceActivity(record, breaks, now);
    await client.query(`UPDATE attendance SET check_out = $2, hours_worked = $3, check_out_location = COALESCE($4, check_out_location), updated_at = NOW() WHERE id = $1`, [record.id, now.toISOString(), Number((activity.total_worked_seconds / 3600).toFixed(2)), location]);
  });
  if (next.record) void notifyAttendancePunch(next.record, "out");
  return next;
}
