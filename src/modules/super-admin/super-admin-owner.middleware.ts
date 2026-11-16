import type { NextFunction, Response } from "express";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import type { AuthRequest } from "../../middleware/role.middleware";
import { SUPER_ADMIN_OWNER_EMAIL } from "./super-admin-activity";

// Client Activity Management and Client Activity are for the Super Admin OWNER account only. Any other Super Admin login (the team members /
// developers) gets 403 from these routes, so hiding the menu is not the only protection.
const cache = new Map<string, { isOwner: boolean; at: number }>();
const TTL_MS = 60_000;

export async function isSuperAdminOwner(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.isOwner;
  const { rows } = await pool.query(`SELECT lower(email) AS email FROM users WHERE id = $1`, [userId]);
  const isOwner = rows[0]?.email === SUPER_ADMIN_OWNER_EMAIL;
  cache.set(userId, { isOwner, at: Date.now() });
  return isOwner;
}

export async function superAdminOwnerOnly(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId || !(await isSuperAdminOwner(userId))) return next(new AppError(403, "Only the Super Admin owner can open this.", "FORBIDDEN"));
    return next();
  } catch (e) {
    return next(e);
  }
}
