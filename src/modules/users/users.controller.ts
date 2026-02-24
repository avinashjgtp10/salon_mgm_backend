import { Request, Response, NextFunction } from "express";
import { usersService } from "./users.service";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";

interface AuthRequest extends Request {
  user?: {
    userId: string;
    role?: string;
  };
}

const getParamString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim())
    return value[0].trim();
  return null;
};

export const usersController = {
  /**
   * GET /api/v1/users/me
   * Protected
   */
  async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;

      logger.info("GET /users/me called", {
        userId,
        method: req.method,
        path: req.originalUrl,
      });

      if (!userId) {
        logger.warn("GET /users/me unauthorized (missing req.user.userId)", {
          method: req.method,
          path: req.originalUrl,
        });
        throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      }

      const user = await usersService.me(userId);

      logger.info("GET /users/me success", {
        userId,
        method: req.method,
        path: req.originalUrl,
      });

      return sendSuccess(res, 200, user, "User profile fetched successfully");
    } catch (error) {
      logger.error("GET /users/me error", {
        method: req.method,
        path: req.originalUrl,
        error,
      });
      return next(error);
    }
  },

  /**
   * GET /api/v1/users
   * Protected (admin in your route middleware)
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      logger.info("GET /users called", {
        method: req.method,
        path: req.originalUrl,
      });

      const users = await usersService.list();

      logger.info("GET /users success", {
        count: Array.isArray(users) ? users.length : undefined,
        method: req.method,
        path: req.originalUrl,
      });

      return sendSuccess(res, 200, users, "Users fetched successfully");
    } catch (error) {
      logger.error("GET /users error", {
        method: req.method,
        path: req.originalUrl,
        error,
      });
      return next(error);
    }
  },

      /**
   * PATCH /api/v1/users/:id/role
   * Protected (admin only in routes)
   */
  async updateRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = getParamString(req.params.id);
      const role = typeof req.body?.role === "string" ? req.body.role.trim() : "";

      logger.info("PATCH /users/:id/role called", {
        id,
        byUserId: req.user?.userId,
        byRole: req.user?.role,
        method: req.method,
        path: req.originalUrl,
      });

      if (!id) {
        logger.warn("PATCH /users/:id/role validation failed (missing id)", {
          method: req.method,
          path: req.originalUrl,
        });
        throw new AppError(400, "User id is required", "USER_ID_REQUIRED");
      }

      if (!role) {
        logger.warn("PATCH /users/:id/role validation failed (missing role)", {
          id,
          method: req.method,
          path: req.originalUrl,
        });
        throw new AppError(400, "role is required", "ROLE_REQUIRED");
      }

      // ✅ only update role (no other fields)
      const updated = await usersService.update(id, { role });

      logger.info("PATCH /users/:id/role success", {
        id,
        newRole: role,
        method: req.method,
        path: req.originalUrl,
      });

      // ✅ uses your sendSuccess (responses.js style)
      return sendSuccess(res, 200, updated, "User role updated successfully");
    } catch (error) {
      logger.error("PATCH /users/:id/role error", {
        method: req.method,
        path: req.originalUrl,
        error,
      });
      return next(error);
    }
  },


  /**
   * GET /api/v1/users/:id
   * Protected
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParamString(req.params.id);

      logger.info("GET /users/:id called", {
        id,
        method: req.method,
        path: req.originalUrl,
      });

      if (!id) {
        logger.warn("GET /users/:id validation failed (missing id)", {
          method: req.method,
          path: req.originalUrl,
        });
        throw new AppError(400, "User id is required", "USER_ID_REQUIRED");
      }

      const user = await usersService.getById(id);

      logger.info("GET /users/:id success", {
        id,
        method: req.method,
        path: req.originalUrl,
      });

      return sendSuccess(res, 200, user, "User fetched successfully");
    } catch (error) {
      logger.error("GET /users/:id error", {
        method: req.method,
        path: req.originalUrl,
        error,
      });
      return next(error);
    }
  },

  /**
   * PATCH /api/v1/users/:id
   * Protected
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParamString(req.params.id);

      logger.info("PATCH /users/:id called", {
        id,
        method: req.method,
        path: req.originalUrl,
      });

      if (!id) {
        logger.warn("PATCH /users/:id validation failed (missing id)", {
          method: req.method,
          path: req.originalUrl,
        });
        throw new AppError(400, "User id is required", "USER_ID_REQUIRED");
      }

      const updated = await usersService.update(id, req.body);

      logger.info("PATCH /users/:id success", {
        id,
        method: req.method,
        path: req.originalUrl,
      });

      return sendSuccess(res, 200, updated, "User updated successfully");
    } catch (error) {
      logger.error("PATCH /users/:id error", {
        method: req.method,
        path: req.originalUrl,
        error,
      });
      return next(error);
    }
  },

  /**
   * DELETE /api/v1/users/:id
   * Protected
   */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParamString(req.params.id);

      logger.info("DELETE /users/:id called", {
        id,
        method: req.method,
        path: req.originalUrl,
      });

      if (!id) {
        logger.warn("DELETE /users/:id validation failed (missing id)", {
          method: req.method,
          path: req.originalUrl,
        });
        throw new AppError(400, "User id is required", "USER_ID_REQUIRED");
      }

      const result = await usersService.remove(id);

      logger.info("DELETE /users/:id success", {
        id,
        method: req.method,
        path: req.originalUrl,
      });

      return sendSuccess(res, 200, result, "User deleted successfully");
      // Strict REST option:
      // return res.sendStatus(204);
    } catch (error) {
      logger.error("DELETE /users/:id error", {
        method: req.method,
        path: req.originalUrl,
        error,
      });
      return next(error);
    }
  },
};
