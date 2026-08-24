import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { AppError } from "../../middleware/error.middleware";
import { getSalonId } from "../utils/salon.util";
import { waPurchaseTemplatesService } from "./wa-purchase-templates.service";

// Ownership guard: the :salonId path param is client-supplied, so a salon_owner
// could otherwise read/edit/submit another salon's templates by changing it.
// Resolve the caller's real salon from the JWT and require it to match (admins
// may act on any salon). Returns the trusted salonId to use downstream.
async function resolveOwnedSalonId(req: Request): Promise<string> {
    const paramSalonId = req.params.salonId as string;
    const role = (req as any).user?.role;
    if (role === "admin") return paramSalonId;
    const ownSalonId = await getSalonId(req);
    if (paramSalonId !== ownSalonId) {
        throw new AppError(403, "You can only manage your own salon's templates", "FORBIDDEN");
    }
    return ownSalonId;
}

export const waPurchaseTemplatesController = {
    // GET /api/v1/wa-automation/purchase-templates/:salonId
    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await resolveOwnedSalonId(req);
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
            const salonId = await resolveOwnedSalonId(req);
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
            const salonId = await resolveOwnedSalonId(req);
            const eventType = req.params.eventType as string;
            const updated = await waPurchaseTemplatesService.submitForApproval(salonId, eventType);
            sendSuccess(res, 200, updated, "Template submitted to Meta for approval");
        } catch (err) {
            next(err);
        }
    },

    // POST /api/v1/wa-automation/purchase-templates/:salonId/:eventType/reset
    // Returns a template to a clean DRAFT state so it can be resubmitted after
    // its Meta-side copy was deleted or rejected.
    async reset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await resolveOwnedSalonId(req);
            const eventType = req.params.eventType as string;
            const updated = await waPurchaseTemplatesService.resetForResubmission(salonId, eventType);
            sendSuccess(res, 200, updated, "Template reset — ready to resubmit");
        } catch (err) {
            next(err);
        }
    },

    // POST /api/v1/wa-automation/purchase-templates/:salonId/:eventType/sync
    async syncStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = await resolveOwnedSalonId(req);
            const eventType = req.params.eventType as string;
            const updated = await waPurchaseTemplatesService.syncStatus(salonId, eventType);
            sendSuccess(res, 200, updated, "Template status synced");
        } catch (err) {
            next(err);
        }
    },
};
