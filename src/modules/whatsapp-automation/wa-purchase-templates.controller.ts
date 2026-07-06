import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { waPurchaseTemplatesService } from "./wa-purchase-templates.service";

export const waPurchaseTemplatesController = {
    // GET /api/v1/wa-automation/purchase-templates/:salonId
    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = req.params.salonId as string;
            const templates = await waPurchaseTemplatesService.list(salonId);
            sendSuccess(res, 200, templates, "Purchase templates fetched");
        } catch (err) {
            next(err);
        }
    },

    // PATCH /api/v1/wa-automation/purchase-templates/:salonId/:eventType
    // Body: { body_text }
    async updateWording(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = req.params.salonId as string;
            const eventType = req.params.eventType as string;
            const updated = await waPurchaseTemplatesService.updateWording(salonId, eventType, req.body.body_text);
            sendSuccess(res, 200, updated, "Template wording updated");
        } catch (err) {
            next(err);
        }
    },

    // POST /api/v1/wa-automation/purchase-templates/:salonId/:eventType/submit
    async submitForApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = req.params.salonId as string;
            const eventType = req.params.eventType as string;
            const updated = await waPurchaseTemplatesService.submitForApproval(salonId, eventType);
            sendSuccess(res, 200, updated, "Template submitted to Meta for approval");
        } catch (err) {
            next(err);
        }
    },

    // POST /api/v1/wa-automation/purchase-templates/:salonId/:eventType/sync
    async syncStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = req.params.salonId as string;
            const eventType = req.params.eventType as string;
            const updated = await waPurchaseTemplatesService.syncStatus(salonId, eventType);
            sendSuccess(res, 200, updated, "Template status synced");
        } catch (err) {
            next(err);
        }
    },
};
