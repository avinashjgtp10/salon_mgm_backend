import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { orderReceiptsService } from "./order-receipts.service";
import { UpsertReceiptBody, ConfirmReceiptBody } from "./order-receipts.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

const getUserId = (req: AuthRequest): string => {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    return userId;
};

export const orderReceiptsController = {
    async getOrCreateDraft(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            const receipt = await orderReceiptsService.getOrCreateDraft({
                orderId: String(req.params.id), salonId, createdBy: userId,
            });
            sendSuccess(res, 200, receipt, "Draft receipt fetched");
        } catch (err) { next(err); }
    },

    async saveDraft(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            logger.info("POST /inventory/orders/:id/receipts/:receiptId/items called", {
                salonId, orderId: req.params.id, receiptId: req.params.receiptId,
            });
            const receipt = await orderReceiptsService.saveDraft({
                receiptId: String(req.params.receiptId), salonId, body: req.body as UpsertReceiptBody,
            });
            sendSuccess(res, 200, receipt, "Draft saved");
        } catch (err) { next(err); }
    },

    async confirm(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            logger.info("POST /inventory/orders/:id/receipts/:receiptId/confirm called", {
                salonId, userId, orderId: req.params.id, receiptId: req.params.receiptId,
            });
            const result = await orderReceiptsService.confirm({
                receiptId: String(req.params.receiptId), salonId, confirmedBy: userId,
                body: req.body as ConfirmReceiptBody,
            });
            sendSuccess(res, 200, result, "Receiving confirmed — stock updated");
        } catch (err) { next(err); }
    },
};
