import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { uploadAvatarToS3 } from "../utils/avatar.upload";
import { spotlightService } from "./spotlight.service";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const spotlightController = {
  /**
   * POST /api/v1/spotlight/upload-image
   * Uploads a Spotlight feature screenshot (multer → S3, or local /uploads
   * fallback) and returns its URL. Same shape as the existing staff/client/
   * user avatar upload endpoints. super_admin-only (see spotlight.routes.ts).
   */
  async uploadImage(req: Request, res: Response, next: NextFunction) {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) throw new AppError(400, "No image file provided", "FILE_REQUIRED");

      const key = `spotlight-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const url = await uploadAvatarToS3(file.path, key, file.mimetype, "spotlight");

      return sendSuccess(res, 200, { url }, "Image uploaded successfully");
    } catch (err) { return next(err); }
  },

  // ── Superadmin: manage (draft/published/archived) ──────────────────────────

  async adminList(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await spotlightService.list(true);
      return sendSuccess(res, 200, data);
    } catch (err) { return next(err); }
  },

  async adminGetById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await spotlightService.getById(String(req.params.id ?? ""));
      return sendSuccess(res, 200, data);
    } catch (err) { return next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const createdBy = req.user!.userId;
      const data = await spotlightService.create(req.body, createdBy);
      return sendSuccess(res, 201, data);
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await spotlightService.update(String(req.params.id ?? ""), req.body);
      return sendSuccess(res, 200, data);
    } catch (err) { return next(err); }
  },

  async publish(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await spotlightService.publish(String(req.params.id ?? ""));
      return sendSuccess(res, 200, data);
    } catch (err) { return next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await spotlightService.delete(String(req.params.id ?? ""));
      return sendSuccess(res, 200, { deleted: true });
    } catch (err) { return next(err); }
  },

  // ── Salon-facing: published only, per-user explored state ──────────────────

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const [features, readIds] = await Promise.all([
        spotlightService.list(false),
        spotlightService.getExploredIds(userId),
      ]);
      return sendSuccess(res, 200, { features, readIds });
    } catch (err) { return next(err); }
  },

  async markExplored(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      await spotlightService.markExplored(String(req.params.id ?? ""), userId);
      const readIds = await spotlightService.getExploredIds(userId);
      return sendSuccess(res, 200, { readIds });
    } catch (err) { return next(err); }
  },
};
