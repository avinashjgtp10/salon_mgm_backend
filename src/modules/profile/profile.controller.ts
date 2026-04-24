import { Request, Response, NextFunction } from "express";
import { usersService } from "../users/users.service";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";

interface AuthRequest extends Request {
  user?: { userId: string; role?: string };
}

export const profileController = {
  /**
   * GET /api/v1/profile/:id
   * Authenticated user can fetch own profile; admin can fetch any.
   */
  async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const requesterId = req.user?.userId;
      const requesterRole = req.user?.role;

      logger.info("GET /profile/:id called", { id, requesterId });

      if (!requesterId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      if (id !== requesterId && requesterRole !== "admin") {
        throw new AppError(403, "Access denied", "FORBIDDEN");
      }

      const user = await usersService.getById(id);

      logger.info("GET /profile/:id success", { id });
      return sendSuccess(res, 200, user, "Profile fetched successfully");
    } catch (error) {
      logger.error("GET /profile/:id error", { error });
      return next(error);
    }
  },

  /**
   * PUT /api/v1/profile/:id
   * Authenticated user can update own profile; admin can update any.
   * Body is pre-validated by validateBody(updateProfileBodySchema).
   */
  async updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const requesterId = req.user?.userId;
      const requesterRole = req.user?.role;

      logger.info("PUT /profile/:id called", { id, requesterId });

      if (!requesterId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      if (id !== requesterId && requesterRole !== "admin") {
        throw new AppError(403, "Access denied", "FORBIDDEN");
      }

      const updated = await usersService.update(id, req.body);

      logger.info("PUT /profile/:id success", { id });
      return sendSuccess(res, 200, updated, "Profile updated successfully");
    } catch (error) {
      logger.error("PUT /profile/:id error", { error });
      return next(error);
    }
  },
};
