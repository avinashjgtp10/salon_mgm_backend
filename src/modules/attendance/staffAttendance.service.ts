import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { ownStaffId } from "../notifications/staffNotificationScope";
import { attendanceRepository } from "./attendance.repository";
import { notifyAttendancePunch } from "./attendance.service";
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
  const record = await attendanceRepository.findByStaffAndDate(staffId, date);
  return {
    staff_id: staffId, date, server_time: now.toISOString(),
    shift_start: window?.start.toISOString() ?? null, shift_end: window?.end.toISOString() ?? null,
    reminder_at: window?.reminderAt.toISOString() ?? null,
    can_check_in: true,
    blocked_reason: null,
    checked_in: Boolean(record?.check_in), record: record ?? null,
  };
}

// `location` (optional) is the device location captured at the punch; callers
// that don't pass it keep the previous behavior (stored location untouched).
export async function staffSelfCheckIn(userId: string, salonId: string, now = new Date(), location: string | null = null) {
  const state = await staffAttendanceState(userId, salonId, now);
  if (state.checked_in) return state; // Retrying never rewrites the original punch.
  await pool.query(
    `INSERT INTO attendance (salon_id, staff_id, date, check_in, status, source, check_in_location)
     VALUES ($1, $2, $3::date, $4::timestamptz, $5, 'manual', $6)
     ON CONFLICT (salon_id, staff_id, date) DO UPDATE
     SET check_in = COALESCE(attendance.check_in, EXCLUDED.check_in),
         status = attendance.status,
         check_in_location = COALESCE(attendance.check_in_location, EXCLUDED.check_in_location),
         updated_at = NOW()`, [salonId, state.staff_id, state.date, now.toISOString(), "present", location]);
  const next = await staffAttendanceState(userId, salonId, now);
  // Same owner/admin "Staff Checked In" notification as manual/device punches.
  if (next.record?.check_in) void notifyAttendancePunch(next.record, "in");
  return next;
}

export async function staffSelfCheckOut(userId: string, salonId: string, now = new Date(), location: string | null = null) {
  const state = await staffAttendanceState(userId, salonId, now);
  const record = state.record;
  if (!record?.check_in) throw new AppError(400, "You have not checked in.", "NOT_CHECKED_IN");
  if (record.check_out) return state;
  const hours = Math.max(0, (now.getTime() - new Date(record.check_in).getTime()) / 3600000);
  const { rowCount } = await pool.query(`UPDATE attendance SET check_out = $4::timestamptz, hours_worked = $5,
      check_out_location = COALESCE($6, check_out_location), updated_at = NOW()
    WHERE salon_id = $1 AND staff_id = $2 AND date = $3::date AND check_out IS NULL`,
    [salonId, state.staff_id, state.date, now.toISOString(), Number(hours.toFixed(2)), location]);
  const next = await staffAttendanceState(userId, salonId, now);
  // Only notify when this request actually recorded the check-out.
  if (rowCount && next.record?.check_out) void notifyAttendancePunch(next.record, "out");
  return next;
}
