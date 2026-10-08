import { Request, Response, NextFunction } from "express";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";

export type MobileStaffContext = { id: string; userId: string; salonId: string };

export type MobileStaffRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string | null };
  staff?: MobileStaffContext;
  staffId?: string;
};

type StaffIdentityRow = {
  staff_id: string;
  staff_active: boolean | null;
  user_active: boolean | null;
  salon_active: boolean | null;
};

/**
 * Resolves the caller's own staff record for every /mobile/staff route.
 * Runs after authMiddleware (valid JWT) and roleMiddleware("staff").
 *
 * The identity comes ONLY from the verified JWT (userId + salonId) and the
 * server-side staff row — never from URL params, query, body or headers.
 * users/salons `is_active` are otherwise only checked at login, so they are
 * re-checked here: a deactivated account loses access on its next request.
 */
export async function requireMobileStaff(req: MobileStaffRequest, _res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId;
    const salonId = req.user?.salonId;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

    // Prefer the active profile if a user was ever linked to more than one row.
    const { rows } = await pool.query<StaffIdentityRow>(
      `SELECT s.id AS staff_id, s.is_active AS staff_active,
              u.is_active AS user_active, sa.is_active AS salon_active
         FROM staff s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN salons sa ON sa.id = s.salon_id
        WHERE s.user_id = $1 AND s.salon_id = $2
        ORDER BY s.is_active DESC NULLS LAST, s.created_at DESC
        LIMIT 1`,
      [userId, salonId],
    );
    const row = rows[0];

    if (!row) throw new AppError(403, "Your account is not linked to a staff profile.", "STAFF_PROFILE_NOT_FOUND");
    if (row.user_active === false) throw new AppError(403, "User is inactive", "USER_INACTIVE");
    if (row.salon_active === false) {
      throw new AppError(403, "Your account is deactivated. Kindly contact the Salonox team.", "SALON_INACTIVE");
    }
    if (row.staff_active === false) throw new AppError(403, "Your staff profile is inactive.", "STAFF_INACTIVE");

    req.staff = { id: row.staff_id, userId, salonId };
    req.staffId = row.staff_id;
    return next();
  } catch (err) { return next(err); }
}
