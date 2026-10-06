import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { ownStaffId } from "../notifications/staffNotificationScope";
import { attendanceRepository } from "./attendance.repository";
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

export async function staffSelfCheckIn(userId: string, salonId: string, now = new Date()) {
  const state = await staffAttendanceState(userId, salonId, now);
  if (state.checked_in) return state; // Retrying never rewrites the original punch.
  await pool.query(
    `INSERT INTO attendance (salon_id, staff_id, date, check_in, status, source)
     VALUES ($1, $2, $3::date, $4::timestamptz, $5, 'manual')
     ON CONFLICT (salon_id, staff_id, date) DO UPDATE
     SET check_in = COALESCE(attendance.check_in, EXCLUDED.check_in),
         status = attendance.status,
         updated_at = NOW()`, [salonId, state.staff_id, state.date, now.toISOString(), "present"]);
  return staffAttendanceState(userId, salonId, now);
}

export async function staffSelfCheckOut(userId: string, salonId: string, now = new Date()) {
  const state = await staffAttendanceState(userId, salonId, now);
  const record = state.record;
  if (!record?.check_in) throw new AppError(400, "You have not checked in.", "NOT_CHECKED_IN");
  if (record.check_out) return state;
  const hours = Math.max(0, (now.getTime() - new Date(record.check_in).getTime()) / 3600000);
  await pool.query(`UPDATE attendance SET check_out = $4::timestamptz, hours_worked = $5, updated_at = NOW()
    WHERE salon_id = $1 AND staff_id = $2 AND date = $3::date AND check_out IS NULL`,
    [salonId, state.staff_id, state.date, now.toISOString(), Number(hours.toFixed(2))]);
  return staffAttendanceState(userId, salonId, now);
}
