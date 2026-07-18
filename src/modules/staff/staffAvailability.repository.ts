import pool from "../../config/database";
import logger from "../../config/logger";
import { staffSchedulesRepository } from "./staffSettings.repository";

export type AvailabilityContext = {
  staff: any;
  branchId: string | null;
  schedule: any | null;
  branchTiming: any | null;
  blockedTimes: any[];
  leaves: any[];
  appointments: any[];
  intervalMinutes: number;
};

export const staffAvailabilityRepository = {
  async findContext(staffId: string, salonId: string, date: string, branchId?: string): Promise<AvailabilityContext | null> {
    logger.info("staffAvailability.findContext input", {
      requestedDate: date,
      staffId,
      salonId,
      requestedBranchId: branchId ?? null,
      staffQueryParams: [staffId, salonId],
    });
    const staffResult = await pool.query(
      `SELECT id, salon_id, branch_id, first_name, last_name, avatar_url, designation
       FROM staff WHERE id = $1 AND salon_id = $2`,
      [staffId, salonId],
    );
    const staff = staffResult.rows[0];
    if (!staff) return null;

    const effectiveBranchId = branchId ?? staff.branch_id ?? null;
    if (branchId && staff.branch_id && branchId !== staff.branch_id) return null;

    if (effectiveBranchId) {
      const branch = await pool.query(
        `SELECT id FROM branches WHERE id = $1 AND salon_id = $2`,
        [effectiveBranchId, salonId],
      );
      if (!branch.rows[0]) return null;
    }

    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    logger.info("staffAvailability.findContext query parameters", {
      requestedDate: date,
      dayOfWeek,
      staffId,
      salonId,
      branchId: effectiveBranchId,
      scheduleQueryParams: [staffId],
      branchTimingQueryParams: effectiveBranchId ? [effectiveBranchId, dayOfWeek] : null,
      blockedTimesQueryParams: [salonId, staffId, date],
      leavesQueryParams: [staffId, date],
      appointmentsQueryParams: [salonId, staffId, date, effectiveBranchId],
      settingsQueryParams: [salonId],
    });

    const [schedules, timingResult, blockedResult, leavesResult, appointmentsResult, settingsResult] = await Promise.all([
      staffSchedulesRepository.listByStaffId(staffId),
      effectiveBranchId
        ? pool.query(
            `SELECT opening_time, closing_time, is_closed
             FROM branch_timings WHERE branch_id = $1 AND day_of_week = $2 LIMIT 1`,
            [effectiveBranchId, dayOfWeek],
          )
        : Promise.resolve({ rows: [] as any[] }),
      pool.query(
        `SELECT id, date, start_time, end_time, reason
         FROM blocked_times WHERE salon_id = $1 AND staff_id = $2 AND date = $3::date
         ORDER BY start_time`,
        [salonId, staffId, date],
      ),
      pool.query(
        `SELECT id, start_date, end_date, leave_type, status, reason
         FROM staff_leaves
         WHERE staff_id = $1 AND start_date <= $2::date AND end_date >= $2::date
           AND LOWER(status) = 'approved'
         ORDER BY start_date`,
        [staffId, date],
      ),
      pool.query(
        `SELECT id, scheduled_at, duration_minutes, status
         FROM appointments
         WHERE salon_id = $1 AND staff_id = $2
           AND scheduled_at >= ($3::date AT TIME ZONE 'Asia/Kolkata')
           AND scheduled_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')
           AND LOWER(status::text) NOT IN ('cancelled', 'no_show')
           AND ($4::uuid IS NULL OR branch_id = $4::uuid)
         ORDER BY scheduled_at`,
        [salonId, staffId, date, effectiveBranchId],
      ),
      pool.query(
        `SELECT key, value FROM salon_settings
         WHERE salon_id = $1 AND key IN ('appointment_interval', 'slot_interval', 'booking_interval')`,
        [salonId],
      ),
    ]);

    const dateKey = (value: unknown): string | null => {
      if (!value) return null;
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
      const parsed = new Date(value as string | number | Date);
      return Number.isNaN(parsed.getTime())
        ? null
        : parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    };
    const exactDateSchedule = schedules.find((row: any) => dateKey(row.date) === date);
    const recurringSchedule = schedules.find((row: any) => row.date == null && row.day_of_week === dayOfWeek);
    const dateBearingWeeklySchedule = schedules.find((row: any) => row.day_of_week === dayOfWeek);
    const selectedSchedule = exactDateSchedule ?? recurringSchedule ?? dateBearingWeeklySchedule ?? null;

    logger.info("staffAvailability.findContext query results", {
      requestedDate: date,
      dayOfWeek,
      scheduleRows: schedules.length,
      selectedScheduleId: selectedSchedule?.id ?? null,
      selectionSource: exactDateSchedule
        ? "exact_date"
        : recurringSchedule
          ? "recurring_weekly"
          : dateBearingWeeklySchedule
            ? "date_bearing_weekly"
            : "none",
      branchTimingRows: timingResult.rows.length,
      blockedTimeRows: blockedResult.rows.length,
      leaveRows: leavesResult.rows.length,
      appointmentRows: appointmentsResult.rows.length,
      settingRows: settingsResult.rows.length,
    });

    const setting = settingsResult.rows.find((row: any) => row.key === "appointment_interval")
      ?? settingsResult.rows.find((row: any) => row.key === "slot_interval")
      ?? settingsResult.rows.find((row: any) => row.key === "booking_interval");
    const configuredInterval = Number(setting?.value);
    const intervalMinutes = Number.isInteger(configuredInterval) && configuredInterval > 0
      ? configuredInterval : 30;

    return {
      staff,
      branchId: effectiveBranchId,
      schedule: selectedSchedule,
      branchTiming: timingResult.rows[0] ?? null,
      blockedTimes: blockedResult.rows,
      leaves: leavesResult.rows,
      appointments: appointmentsResult.rows,
      intervalMinutes,
    };
  },
};
