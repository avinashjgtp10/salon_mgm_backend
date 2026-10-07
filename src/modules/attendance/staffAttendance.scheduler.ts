import pool from "../../config/database";
import type { PoolClient } from "pg";
import logger from "../../config/logger";
import { notificationsRepository } from "../notifications/notifications.repository";
import { deviceTokensRepository } from "../notifications/deviceTokens.repository";
import { pushNotificationService } from "../notifications/pushNotification.service";
import { staffAttendanceState } from "./staffAttendance.service";

let timer: NodeJS.Timeout | null = null;
let running = false;
export async function runAttendanceReminderSweep() {
  if (running) return;
  running = true;
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(73190412) AS locked");
    locked = lock.rows[0]?.locked === true;
    if (!locked) return;
    const { rows } = await client.query<{ user_id: string; salon_id: string }>(
      `SELECT DISTINCT s.user_id, s.salon_id FROM staff s
       CROSS JOIN LATERAL generate_series(
         (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1,
         (NOW() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') AS days(day)
       JOIN LATERAL (
         SELECT ss.* FROM staff_schedules ss WHERE ss.staff_id = s.id
           AND (ss.date = day::date OR (ss.date IS NULL AND ss.day_of_week = EXTRACT(DOW FROM day)))
         ORDER BY ss.date NULLS LAST LIMIT 1
       ) shift ON shift.is_available = true AND shift.start_time IS NOT NULL AND shift.end_time IS NOT NULL
       WHERE s.is_active = true AND s.user_id IS NOT NULL
         AND NOW() >= ((day::date + shift.start_time) AT TIME ZONE 'Asia/Kolkata') + interval '15 minutes'
         AND NOW() < ((day::date + shift.end_time + CASE WHEN shift.end_time <= shift.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE 'Asia/Kolkata')
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.staff_id = s.id AND a.salon_id = s.salon_id AND a.date = day::date AND a.check_in IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM staff_leaves l WHERE l.staff_id = s.id AND l.status = 'approved' AND day::date BETWEEN l.start_date::date AND l.end_date::date)`);
    for (const candidate of rows) {
      try {
        const state = await staffAttendanceState(candidate.user_id, candidate.salon_id);
        if (state.checked_in || !state.can_check_in || !state.reminder_at || Date.now() < new Date(state.reminder_at).getTime()) continue;
        // alert_status is constrained to inventory alerts; use a dated title for daily deduplication.
        const title = `You haven't checked in (${state.date})`;
        const existing = await client.query<{ id: string; resolved_at: string | null }>(
          "SELECT id, resolved_at FROM notifications WHERE salon_id = $1 AND type = 'attendance' AND reference_id::text = $2 AND title = $3 LIMIT 1",
          [candidate.salon_id, state.staff_id, title]);
        if (existing.rows[0]?.resolved_at) continue;
        const startLabel = new Date(state.shift_start!).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
        const body = `Your shift started at ${startLabel}. Open SalonOX and check in.`;
        const notification = existing.rows[0] ?? await notificationsRepository.create({
          salon_id: candidate.salon_id, reference_id: state.staff_id, type: "attendance", title, body,
          recipient_user_ids: [candidate.user_id],
        });
        const devices = await deviceTokensRepository.getUserTokens(candidate.user_id);
        const tokens = [...new Set(devices.filter(device => device.salon_id === candidate.salon_id).map(device => device.expo_push_token))];
        if (!tokens.length) continue;
        const result = await pushNotificationService.sendToTokens({
          tokens, notificationId: notification.id, salonId: candidate.salon_id, title, body,
          data: { type: "attendance", event_key: "attendanceReminder", salon_id: candidate.salon_id,
            recipient_user_ids: [candidate.user_id], notification_id: notification.id },
          priority: "high", sound: "default", channelId: "salonox",
        });
        if (result.sentCount > 0) {
          await client.query("UPDATE notifications SET resolved_at = NOW() WHERE id = $1", [notification.id]);

        }
      } catch (error) { logger.warn("Attendance reminder failed", { userId: candidate.user_id, error }); }
    }
  } finally {
    if (locked && client) await client.query("SELECT pg_advisory_unlock(73190412)").catch(() => undefined);
    client?.release(); running = false;
  }
}
export function startAttendanceReminderScheduler() {
  if (timer) return;
  const sweep = () => void runAttendanceReminderSweep().catch(error => logger.error("Attendance reminder sweep failed", { error }));
  sweep(); timer = setInterval(sweep, 60000);
}
export function stopAttendanceReminderScheduler() { if (timer) clearInterval(timer); timer = null; }
