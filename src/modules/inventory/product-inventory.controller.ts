import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { productInventoryRepository } from "./product-inventory.repository";

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

export const productInventoryController = {
    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const { search, category_id, brand_id, stock_status, product_id } = req.query;
            const result = await productInventoryRepository.list(
                {
                    search: (search as string) || undefined,
                    category_id: (category_id as string) || undefined,
                    brand_id: (brand_id as string) || undefined,
                    stock_status: stock_status === "low" ? "low" : "all",
                    product_id: (product_id as string) || undefined,
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

    async filterOptions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            sendSuccess(res, 200, await productInventoryRepository.filterOptions(salonId));
        } catch (err) {
            next(err);
        }
    },

    async stockIn(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Authentication required", "NO_USER");

            const quantity = Number(req.body?.quantity);
            // Validated here as well as on the form: the endpoint is reachable
            // directly, and a zero/negative "addition" would write a movement
            // row that silently reduced stock while reading as a stock-in.
            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new AppError(400, "Quantity must be greater than zero", "INVALID_QUANTITY");
            }

            const result = await productInventoryRepository.stockIn({
                productId: String(req.params.id),
                salonId,
                quantity,
                notes: req.body?.notes ?? null,
                supplierId: req.body?.supplier_id ?? null,
                unitPrice: req.body?.unit_price != null ? Number(req.body.unit_price) : null,
                createdBy: userId,
            });

            logger.info("Product stock-in recorded", {
                salonId, userId, productId: req.params.id,
                quantity, before: result.before, after: result.after,
            });
            sendSuccess(res, 201, result, "Stock added");
        } catch (err: any) {
            if (err?.message === "Product not found in this salon") {
                next(new AppError(404, err.message, "PRODUCT_NOT_FOUND"));
                return;
            }
            if (err?.message === "Quantity must be greater than zero") {
                next(new AppError(400, err.message, "INVALID_QUANTITY"));
                return;
            }
            next(err);
        }
    },

    async history(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const result = await productInventoryRepository.history(
                {
                    // Omitted on the "all products" history view, present when
                    // drilling into one product's own additions.
                    productId: (req.query.product_id as string) || undefined,
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
};
