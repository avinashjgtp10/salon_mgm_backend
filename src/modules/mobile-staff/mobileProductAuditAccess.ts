import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { isMobileStaffRequest } from "../notifications/staffNotificationScope";

// ── Mobile-only "Product Audit access" switch ────────────────────────────────
// Same model as the Calendar & Quick Sale switch (mobileCalendarAccess.ts): an
// owner turns this on per staff member from the mobile app
// (PUT /mobile/owner/staff/:staffId/product-audit-access). While it is on,
// requests from the mobile app (X-Salonox-Client: mobile) pass the permission
// keys below even if the staff member's Roles & Permissions don't grant them.
// Web requests never consult it.
//
// Only what performing an audit needs:
//   view_product_audit    list and open audits
//   create_product_audit  create an audit, add/count/scan items, submit,
//                         reopen, and the branch picker
//                         (GET /branches/by-salon accepts this key)
//   view_products         the Add Product form data (brands, product
//                         lookups) when the scanner finds an unknown product
//   create_products       saving that new product (POST /products) and adding
//                         a brand for it (POST /products/brands)
// Approving/rejecting (approve_product_audit), deleting audits, and editing or
// deleting existing products stay with Roles & Permissions.
export const MOBILE_PRODUCT_AUDIT_ACCESS_KEYS: ReadonlySet<string> = new Set([
    "view_product_audit",
    "create_product_audit",
    "view_products",
    "create_products",
]);

const CACHE_TTL_MS = 60_000; // 1 minute, same as permission.middleware.ts

// `${userId}:${salonId}` → { enabled, expiresAt }
const accessCache = new Map<string, { enabled: boolean; expiresAt: number }>();

const cacheKey = (userId: string, salonId: string) => `${userId}:${salonId}`;

export function invalidateMobileProductAuditAccessCache(userId: string, salonId: string) {
    accessCache.delete(cacheKey(userId, salonId));
}

// A database that hasn't run add_staff_mobile_product_audit_access.sql yet (no
// column) simply means the switch is off — it must never take permission
// checks down.
const isMissingColumn = (err: any) => err?.code === "42703";

export async function isMobileProductAuditAccessEnabled(userId: string, salonId: string): Promise<boolean> {
    const key = cacheKey(userId, salonId);
    const now = Date.now();
    const cached = accessCache.get(key);
    if (cached && cached.expiresAt > now) return cached.enabled;

    let enabled = false;
    try {
        // Same "own active profile" resolution as isMobileCalendarAccessEnabled().
        const { rows } = await pool.query<{ enabled: boolean }>(
            `SELECT mobile_product_audit_access AS enabled FROM staff
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
export async function mobileProductAuditAccessGrants(
    req: {
        user?: { userId?: string; role?: string | null; salonId?: string | null };
        headers: { [key: string]: string | string[] | undefined };
    },
    permKeys: string[]
): Promise<boolean> {
    if (!isMobileStaffRequest(req)) return false;
    if (!permKeys.some((key) => MOBILE_PRODUCT_AUDIT_ACCESS_KEYS.has(key))) return false;
    const userId = req.user?.userId;
    const salonId = req.user?.salonId;
    if (!userId || !salonId) return false;
    return isMobileProductAuditAccessEnabled(userId, salonId);
}

// ── Owner reads/writes (scoped to the caller's salon) ─────────────────────────

export async function listStaffMobileProductAuditAccess(
    salonId: string
): Promise<{ staffId: string; productAuditAccess: boolean }[]> {
    try {
        const { rows } = await pool.query<{ id: string; enabled: boolean }>(
            `SELECT id, mobile_product_audit_access AS enabled FROM staff WHERE salon_id = $1`,
            [salonId]
        );
        return rows.map((row) => ({ staffId: row.id, productAuditAccess: row.enabled === true }));
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        const { rows } = await pool.query<{ id: string }>(`SELECT id FROM staff WHERE salon_id = $1`, [salonId]);
        return rows.map((row) => ({ staffId: row.id, productAuditAccess: false }));
    }
}

export async function getStaffMobileProductAuditAccess(staffId: string, salonId: string): Promise<boolean> {
    try {
        const { rows } = await pool.query<{ enabled: boolean }>(
            `SELECT mobile_product_audit_access AS enabled FROM staff WHERE id = $1 AND salon_id = $2`,
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

export async function setStaffMobileProductAuditAccess(
    staffId: string,
    salonId: string,
    enabled: boolean
): Promise<boolean> {
    let rows: { user_id: string | null; enabled: boolean }[];
    try {
        ({ rows } = await pool.query<{ user_id: string | null; enabled: boolean }>(
            `UPDATE staff SET mobile_product_audit_access = $3, updated_at = NOW()
              WHERE id = $1 AND salon_id = $2
              RETURNING user_id, mobile_product_audit_access AS enabled`,
            [staffId, salonId, enabled]
        ));
    } catch (err) {
        if (!isMissingColumn(err)) throw err;
        throw new AppError(
            503,
            "Product audit access can't be saved until the add_staff_mobile_product_audit_access migration has been run.",
            "MIGRATION_REQUIRED"
        );
    }
    if (!rows[0]) throw new AppError(404, "Staff member not found", "NOT_FOUND");
    if (rows[0].user_id) invalidateMobileProductAuditAccessCache(rows[0].user_id, salonId);
    return rows[0].enabled === true;
}
