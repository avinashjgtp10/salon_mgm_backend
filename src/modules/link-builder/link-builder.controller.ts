import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";
import { linkBuilderService } from "./link-builder.service";
import { GenerateLinkBody, SaveLinkBody } from "./link-builder.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

export const linkBuilderController = {
    // POST /api/v1/link-builder/generate
    async generate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

            const body = req.body as GenerateLinkBody;
            if (!body?.type) throw new AppError(400, "type is required", "VALIDATION_ERROR");

            logger.info("POST /link-builder/generate called", { salonId, type: body.type });

            const result = await linkBuilderService.generate(salonId, body);

            logger.info("POST /link-builder/generate success", { salonId, bookingUrl: result.bookingUrl });

            return sendSuccess(res, 200, result, "Booking link generated successfully");
        } catch (err) {
            logger.error("POST /link-builder/generate error", { err });
            return next(err);
        }
    },

    // GET /api/v1/link-builder/saved
    async listSaved(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const data = await linkBuilderService.listSaved(salonId);
            return sendSuccess(res, 200, data, "Saved links fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    // POST /api/v1/link-builder/saved
    async save(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const data = await linkBuilderService.saveLink(salonId, req.body as SaveLinkBody);
            return sendSuccess(res, 201, data, "Link saved successfully");
        } catch (err) {
            return next(err);
        }
    },

    // DELETE /api/v1/link-builder/saved/:id
    async deleteSaved(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            await linkBuilderService.deleteSaved(String(req.params.id), salonId);
            return sendSuccess(res, 200, null, "Saved link deleted");
        } catch (err) {
            return next(err);
        }
    },
};
