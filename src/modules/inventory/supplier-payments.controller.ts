import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { supplierPaymentsService } from "./supplier-payments.service";
import { CreateSupplierPaymentBody } from "./inventory.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

const asPositiveInt = (value: unknown, fallback: number): number => {
    const n = parseInt(String(value ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const supplierPaymentsController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const salonId = getSalonId(req);
            const supplierId = String(req.params.id || "").trim();

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!supplierId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            logger.info("POST /inventory/suppliers/:id/payments called", { supplierId, userId, salonId });

            const payment = await supplierPaymentsService.create({
                supplierId,
                requesterUserId: userId,
                salonId,
                body: req.body as CreateSupplierPaymentBody,
            });

            sendSuccess(res, 201, payment, "Payment recorded successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const supplierId = String(req.params.id || "").trim();
            if (!supplierId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const result = await supplierPaymentsService.list(
                supplierId,
                { page: asPositiveInt(req.query.page, 1), limit: asPositiveInt(req.query.limit, 20) },
                salonId,
            );
            sendSuccess(res, 200, result, "Payment history fetched successfully");
        } catch (err) { next(err); }
    },
};
