import pool from "../../config/database";

export const isStaffAccount = (role?: string | null) =>
  ["staff", "employee", "stylist", "team_member", "team-member"].includes((role ?? "").toLowerCase());

export async function appointmentRecipients(salonId: string, appointmentId?: string): Promise<string[]> {
  if (!appointmentId) return [];
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT s.user_id FROM staff s JOIN appointments a ON a.salon_id = s.salon_id
     WHERE a.id::text = $2 AND a.salon_id = $1 AND s.user_id IS NOT NULL AND s.is_active = true
       AND (a.staff_id = s.id OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(a.services::jsonb, '[]'::jsonb)) service
         WHERE service->>'staff_id' = s.id::text))`, [salonId, appointmentId]);
  return rows.map(row => row.user_id);
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
