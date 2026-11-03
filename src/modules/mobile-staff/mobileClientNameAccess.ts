import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";

// ── Mobile-only "Client name access" switch ──────────────────────────────────
// The mobile app masks client names for staff. An owner turns this on per
// staff member from the mobile app
// (PUT /mobile/owner/staff/:staffId/client-name-access) to let that staff
// member see clients' full names. It only changes what the app displays, so
// unlike the Calendar and Product Audit switches it grants no permission keys.
// Web requests never consult it.

// A database that hasn't run add_staff_mobile_client_name_access.sql yet (no
// column) simply means the switch is off.
const isMissingColumn = (err: any) => err?.code === "42703";

// ── Owner reads/writes (scoped to the caller's salon) ─────────────────────────

export async function listStaffMobileClientNameAccess(
    salonId: string
): Promise<{ staffId: string; clientNameAccess: boolean }[]> {
    try {
        const { rows } = await pool.query<{ id: string; enabled: boolean }>(
            `SELECT id, mobile_client_name_access AS enabled FROM staff WHERE salon_id = $1`,
            [salonId]
        );
        return rows.map((row) => ({ staffId: row.id, clientNameAccess: row.enabled === true }));
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        const { rows } = await pool.query<{ id: string }>(`SELECT id FROM staff WHERE salon_id = $1`, [salonId]);
        return rows.map((row) => ({ staffId: row.id, clientNameAccess: false }));
    }
}

export async function getStaffMobileClientNameAccess(staffId: string, salonId: string): Promise<boolean> {
    try {
        const { rows } = await pool.query<{ enabled: boolean }>(
            `SELECT mobile_client_name_access AS enabled FROM staff WHERE id = $1 AND salon_id = $2`,
            [staffId, salonId]
        );
        if (!rows[0]) throw new AppError(404, "Staff member not found", "NOT_FOUND");
        return rows[0].enabled === true;
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        const { rows } = await pool.query(
            `SELECT 1 FROM staff WHERE id = $1 AND salon_id = $2`,
            [staffId, salonId]
        );
        if (!rows[0]) throw new AppError(404, "Staff member not found", "NOT_FOUND");
        return false;
    }
}

export async function setStaffMobileClientNameAccess(
    staffId: string,
    salonId: string,
    enabled: boolean
): Promise<boolean> {
    let rows: { enabled: boolean }[];
    try {
        ({ rows } = await pool.query<{ enabled: boolean }>(
            `UPDATE staff SET mobile_client_name_access = $3, updated_at = NOW()
              WHERE id = $1 AND salon_id = $2
              RETURNING mobile_client_name_access AS enabled`,
            [staffId, salonId, enabled]
        ));
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        throw new AppError(
            503,
            "Client name access can't be saved until the add_staff_mobile_client_name_access migration has been run.",
            "MIGRATION_REQUIRED"
        );
    }
    if (!rows[0]) throw new AppError(404, "Staff member not found", "NOT_FOUND");
    return rows[0].enabled === true;
}
