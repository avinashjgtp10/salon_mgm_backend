import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { blockedTimesService } from "./blocked_times.service";
import type { CreateBlockedTimeBody, UpdateBlockedTimeBody } from "./blocked_times.types";

type AuthRequest = Request & { user?: { userId: string; role?: string } };

export const blockedTimesController = {

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const record = await blockedTimesService.create({
        requesterUserId: userId,
        body: req.body as CreateBlockedTimeBody,
      });
      return sendSuccess(res, 201, record, "Blocked time created successfully");
    } catch (err) { return next(err); }
  },

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const records = await blockedTimesService.list({
        salon_id: String(req.query.salon_id || "").trim() || undefined,
        staff_id: String(req.query.staff_id || "").trim() || undefined,
        date:     String(req.query.date     || "").trim() || undefined,
      });
      return sendSuccess(res, 200, records, "Blocked times fetched successfully");
    } catch (err) { return next(err); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const record = await blockedTimesService.getById(id);
      return sendSuccess(res, 200, record, "Blocked time fetched successfully");
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const record = await blockedTimesService.update({
        id,
        requesterUserId: userId,
        patch: req.body as UpdateBlockedTimeBody,
      });
      return sendSuccess(res, 200, record, "Blocked time updated successfully");
    } catch (err) { return next(err); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const record = await blockedTimesService.delete(id);
      return sendSuccess(res, 200, record, "Blocked time deleted successfully");
    } catch (err) { return next(err); }
  },
};
