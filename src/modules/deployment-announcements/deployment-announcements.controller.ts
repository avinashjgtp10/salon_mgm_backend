import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { deploymentAnnouncementsService } from "./deployment-announcements.service";
import { CreateDeploymentAnnouncementBody } from "./deployment-announcements.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string | null };
};

export const deploymentAnnouncementsController = {
  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateDeploymentAnnouncementBody;
      if (!body.message?.trim()) throw new AppError(400, "message is required", "VALIDATION_ERROR");
      if (!body.end_time) throw new AppError(400, "end_time is required", "VALIDATION_ERROR");
      const startTime = body.start_time ? new Date(body.start_time) : new Date();
      const endTime = new Date(body.end_time);
      if (isNaN(endTime.getTime())) throw new AppError(400, "end_time is invalid", "VALIDATION_ERROR");
      if (endTime <= startTime) throw new AppError(400, "end_time must be after start_time", "VALIDATION_ERROR");

      const data = await deploymentAnnouncementsService.create(body, req.user?.userId ?? null);
      sendSuccess(res, 201, data, "Deployment announcement started");
    } catch (err) { next(err); }
  },

  async stop(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await deploymentAnnouncementsService.stop(String(req.params.id));
      if (!data) throw new AppError(404, "Announcement not found", "NOT_FOUND");
      sendSuccess(res, 200, data, "Deployment announcement stopped");
    } catch (err) { next(err); }
  },

  async listRecent(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await deploymentAnnouncementsService.listRecent();
      sendSuccess(res, 200, data, "Recent deployment announcements fetched");
    } catch (err) { next(err); }
  },

  // Public to any authenticated user (salon owner/staff) — not super-admin
  // only, since every dashboard needs to poll this to decide whether to show
  // the banner.
  async getActive(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await deploymentAnnouncementsService.getActive();
      sendSuccess(res, 200, data, "Active deployment announcement fetched");
    } catch (err) { next(err); }
  },
};
