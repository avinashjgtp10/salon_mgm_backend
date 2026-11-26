import pool from "../config/database";
import { AppError } from "./error.middleware";

// "May this signed-in user see or change THIS salon's billing?" A salon id that arrives in the URL or body is only a request:
// being logged in is not enough. Allowed:
//   - a Super Admin (any salon)
//   - the salon in the user's own login token (staff and owners; also the branch owner's "enter salon" token)
//   - the owner of the salon, or a branch owner it is assigned to (checked in the database)
// With `ownerOnly` (payments, starting a trial, changing billing) staff of the salon are not enough: only its owner / admin.

export type AccessUser = { userId?: string; role?: string; salonId?: string | null } | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const noSalonAccess = () => new AppError(403, "You don't have access to this salon", "FORBIDDEN");

export async function canAccessSalon(user: AccessUser, salonId: unknown, opts: { ownerOnly?: boolean } = {}): Promise<boolean> {
    if (!user?.userId || typeof salonId !== "string" || !salonId) return false;
    if (user.role === "super_admin") return true;
    const ownToken = Boolean(user.salonId) && user.salonId === salonId;
    if (ownToken && (!opts.ownerOnly || user.role === "salon_owner" || user.role === "admin")) return true;
    if (!UUID_RE.test(salonId)) return false;
    const owns = await pool.query(`SELECT 1 FROM salons WHERE id = $1 AND owner_id = $2`, [salonId, user.userId]);
    if (owns.rows.length) return true;
    if (user.role !== "branch_owner") return false;
    const assigned = await pool.query(`SELECT 1 FROM branch_owner_salons WHERE salon_id = $1 AND branch_owner_id = $2`, [salonId, user.userId]);
    return assigned.rows.length > 0;
}

export async function assertSalonAccess(user: AccessUser, salonId: unknown, opts: { ownerOnly?: boolean } = {}): Promise<void> {
    if (!(await canAccessSalon(user, salonId, opts))) throw noSalonAccess();
}
