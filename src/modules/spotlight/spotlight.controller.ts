import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { uploadAvatarToS3 } from "../utils/avatar.upload";

/**
 * POST /api/v1/spotlight/upload-image
 * Uploads a Spotlight feature screenshot (multer → S3, or local /uploads
 * fallback) and returns its URL. Stateless — Spotlight feature data itself
 * still lives in the frontend's localStorage (no Spotlight CRUD backend
 * exists yet); this endpoint only replaces storing images as base64 data
 * URLs in the browser with a real, shared, hosted URL. Same shape as the
 * existing staff/client/user avatar upload endpoints.
 */
export const spotlightController = {
  async uploadImage(req: Request, res: Response, next: NextFunction) {
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) throw new AppError(400, "No image file provided", "FILE_REQUIRED");

      const key = `spotlight-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const url = await uploadAvatarToS3(file.path, key, file.mimetype, "spotlight");

      return sendSuccess(res, 200, { url }, "Image uploaded successfully");
    } catch (err) { return next(err); }
  },
};
