// src/middleware/role.middleware.ts

import { Request, Response, NextFunction } from "express";
import { AppError } from "./error.middleware";

export type Role = "admin" | "salon_owner" | "staff" | "client";

export type AuthRequest = Request & {
  user?: {
    userId: string;
    role?: Role | string;
  };
};

export const roleMiddleware =
  (...allowedRoles: Role[]) =>
  (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user?.userId) {
        throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      }

      const role = user.role;
      if (!role) {
        throw new AppError(403, "Role missing", "ROLE_MISSING");
      }

      if (!allowedRoles.includes(role as Role)) {
        throw new AppError(403, "Forbidden", "FORBIDDEN");
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };

// ✅ This is protect (alias)
export const protect = roleMiddleware;
