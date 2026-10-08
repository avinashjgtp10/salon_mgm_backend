import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { isMobileStaffRequest } from "../notifications/staffNotificationScope";

// ── Mobile-only "Calendar & Quick Sale access" switch ─────────────────────────
// An owner turns this on per staff member from the mobile app
// (PUT /mobile/owner/staff/:staffId/calendar-access). While it is on, requests
// from the mobile app (X-Salonox-Client: mobile) pass the permission keys
// below even if the staff member's Roles & Permissions don't grant them.
// Web requests never consult it, so the web app keeps behaving exactly as
// Roles & Permissions says.
//
// Only what booking + billing a Quick Sale from the Calendar needs:
//   create_sales         sales init/create/edit/checkout, the walk-in
//                        appointment behind every Quick Sale, catalog reads
//   view_sales           the receipt shown after checkout (GET /sales/:id)
//   create_clients       adding a new client from the Quick Sale client picker
//   view_client_packages the client's active packages (package coverage)
//   edit_package         consuming package sessions when the sale completes
//   view_client_history  reward-point / referral balances at checkout
//   view_appointment     the client's membership assignments at checkout
//   view_calendar        every staff member's appointments on the Calendar
//                        (GET /appointments), not just the caller's own
export const MOBILE_CALENDAR_ACCESS_KEYS: ReadonlySet<string> = new Set([
    "view_calendar",
    "create_sales",
    "view_sales",
    "create_clients",
    "view_client_packages",
    "edit_package",
    "view_client_history",
    "view_appointment",
]);

const CACHE_TTL_MS = 60_000; // 1 minute, same as permission.middleware.ts

// `${userId}:${salonId}` → { enabled, expiresAt }
const accessCache = new Map<string, { enabled: boolean; expiresAt: number }>();

const cacheKey = (userId: string, salonId: string) => `${userId}:${salonId}`;

export function invalidateMobileCalendarAccessCache(userId: string, salonId: string) {
    accessCache.delete(cacheKey(userId, salonId));
}

// A database that hasn't run add_staff_mobile_calendar_access.sql yet (no
// column) simply means the switch is off — it must never take permission
// checks down.
const isMissingColumn = (err: any) => err?.code === "42703";

export async function isMobileCalendarAccessEnabled(userId: string, salonId: string): Promise<boolean> {
    const key = cacheKey(userId, salonId);
    const now = Date.now();
    const cached = accessCache.get(key);
    if (cached && cached.expiresAt > now) return cached.enabled;

    let enabled = false;
    try {
        // Same "own active profile" resolution as ownStaffId().
        const { rows } = await pool.query<{ enabled: boolean }>(
            `SELECT mobile_calendar_access AS enabled FROM staff
              WHERE user_id = $1 AND salon_id = $2 AND is_active = true
              ORDER BY created_at DESC LIMIT 1`,
            [userId, salonId]
        );
        enabled = rows[0]?.enabled === true;
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
    }

    accessCache.set(key, { enabled, expiresAt: now + CACHE_TTL_MS });
    return enabled;
}

// Used by requirePermission()/requireAnyPermission(): true when this is a
// mobile-app staff request, at least one of the checked keys is covered by the
// switch, and the switch is on for the caller.
export async function mobileCalendarAccessGrants(
    req: {
        user?: { userId?: string; role?: string | null; salonId?: string | null };
        headers: { [key: string]: string | string[] | undefined };
    },
    permKeys: string[]
): Promise<boolean> {
    if (!isMobileStaffRequest(req)) return false;
    if (!permKeys.some((key) => MOBILE_CALENDAR_ACCESS_KEYS.has(key))) return false;
    const userId = req.user?.userId;
    const salonId = req.user?.salonId;
    if (!userId || !salonId) return false;
    return isMobileCalendarAccessEnabled(userId, salonId);
}

// ── Owner reads/writes (scoped to the caller's salon) ─────────────────────────

// Every staff member's switch in one call, for the app's Staff Permissions
// screen. Staff without a row value (or a database without the migration)
// read as off.
export async function listStaffMobileCalendarAccess(
    salonId: string
): Promise<{ staffId: string; calendarAccess: boolean }[]> {
    try {
        const { rows } = await pool.query<{ id: string; enabled: boolean }>(
            `SELECT id, mobile_calendar_access AS enabled FROM staff WHERE salon_id = $1`,
            [salonId]
        );
        return rows.map((row) => ({ staffId: row.id, calendarAccess: row.enabled === true }));
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        const { rows } = await pool.query<{ id: string }>(`SELECT id FROM staff WHERE salon_id = $1`, [salonId]);
        return rows.map((row) => ({ staffId: row.id, calendarAccess: false }));
    }
}

export async function getStaffMobileCalendarAccess(staffId: string, salonId: string): Promise<boolean> {
    try {
        const { rows } = await pool.query<{ enabled: boolean }>(
            `SELECT mobile_calendar_access AS enabled FROM staff WHERE id = $1 AND salon_id = $2`,
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

export async function setStaffMobileCalendarAccess(
    staffId: string,
    salonId: string,
    enabled: boolean
): Promise<boolean> {
    let rows: { user_id: string | null; enabled: boolean }[];
    try {
        ({ rows } = await pool.query<{ user_id: string | null; enabled: boolean }>(
            `UPDATE staff SET mobile_calendar_access = $3, updated_at = NOW()
              WHERE id = $1 AND salon_id = $2
              RETURNING user_id, mobile_calendar_access AS enabled`,
            [staffId, salonId, enabled]
        ));
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        throw new AppError(
            503,
            "Calendar access can't be saved until the add_staff_mobile_calendar_access migration has been run.",
            "MIGRATION_REQUIRED"
        );
    }
    if (!rows[0]) throw new AppError(404, "Staff member not found", "NOT_FOUND");
    if (rows[0].user_id) invalidateMobileCalendarAccessCache(rows[0].user_id, salonId);
    return rows[0].enabled === true;
}
