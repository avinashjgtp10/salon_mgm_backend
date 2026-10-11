import pool from "../../config/database";
import { buildStaffNotificationContent, StaffAppointmentRow } from "./staffNotificationContent";

export const isStaffAccount = (role?: string | null) =>
  ["staff", "employee", "stylist", "team_member", "team-member"].includes((role ?? "").toLowerCase());

export async function appointmentRecipients(salonId: string, appointmentId?: string): Promise<string[]> {
  return (await appointmentStaffNotifications(salonId, appointmentId)).map(item => item.userId);
}

export async function appointmentStaffNotifications(salonId: string, appointmentId?: string) {
  if (!appointmentId) return [];
  const { rows } = await pool.query<StaffAppointmentRow>(
    `SELECT s.user_id, s.id::text AS staff_id, a.staff_id::text AS appointment_staff_id,
       a.services, a.status, c.full_name AS client_name, svc.name AS service_name,
       (SELECT sale.invoice_number FROM sales sale WHERE sale.appointment_id = a.id
        AND sale.deleted_at IS NULL ORDER BY sale.created_at DESC LIMIT 1) AS invoice_number
     FROM staff s JOIN appointments a ON a.salon_id = s.salon_id
     LEFT JOIN clients c ON c.id = a.client_id AND c.salon_id = a.salon_id
     LEFT JOIN services svc ON svc.id = a.service_id
     WHERE a.id::text = $2 AND a.salon_id = $1 AND s.user_id IS NOT NULL AND s.is_active = true
       AND (a.staff_id = s.id OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(a.services::jsonb, '[]'::jsonb)) service
         WHERE service->>'staff_id' = s.id::text))`, [salonId, appointmentId]);
  return buildStaffNotificationContent(rows);
}

export async function ownStaffId(userId: string, salonId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM staff WHERE user_id = $1 AND salon_id = $2 AND is_active = true
     ORDER BY created_at DESC LIMIT 1`, [userId, salonId]);
  return rows[0]?.id ?? null;
}

// The mobile app opts into own-data reads; web requests retain their existing
// permission checks. Authentication and token issuance stay unchanged.
export function isMobileStaffRequest(req: {
  user?: { role?: string | null };
  headers: { [key: string]: string | string[] | undefined };
}): boolean {
  return isStaffAccount(req.user?.role) && req.headers["x-salonox-client"] === "mobile";
}
