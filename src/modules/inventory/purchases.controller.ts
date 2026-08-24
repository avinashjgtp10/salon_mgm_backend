import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { purchasesRepository } from "./purchases.repository";

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

export const purchasesController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Authentication required", "NO_USER");

            const result = await purchasesRepository.create(
                {
                    supplier_id: req.body.supplier_id,
                    purchase_date: req.body.purchase_date ?? undefined,
                    items: req.body.items.map((i: any) => ({
                        product_id: i.product_id,
                        quantity: Number(i.quantity),
                        purchase_price: Number(i.purchase_price),
                        expiry_date: i.expiry_date ?? null,
                    })),
                },
                salonId,
                userId,
            );

            logger.info("Purchase recorded", {
                salonId, userId,
                purchaseNumber: result.purchase.purchase_number,
                itemCount: result.updatedProducts.length,
            });
            sendSuccess(res, 201, result, "Purchase recorded");
        } catch (err: any) {
            if (typeof err?.message === "string" && err.message.startsWith("Product not found in this salon")) {
                next(new AppError(404, err.message, "PRODUCT_NOT_FOUND"));
                return;
            }
            next(err);
        }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const result = await purchasesRepository.list(
                {
                    search: (req.query.search as string) || undefined,
                    page: asPositiveInt(req.query.page, 1),
                    limit: asPositiveInt(req.query.limit, 20),
                },
                salonId,
            );
            sendSuccess(res, 200, result);
        } catch (err) {
            next(err);
        }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const purchase = await purchasesRepository.getById(String(req.params.id), salonId);
            if (!purchase) {
                next(new AppError(404, "Purchase not found", "PURCHASE_NOT_FOUND"));
                return;
            }
            sendSuccess(res, 200, purchase);
        } catch (err) {
            next(err);
        }
    },
};
