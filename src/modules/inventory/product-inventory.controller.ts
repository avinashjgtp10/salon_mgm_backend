import { Request, Response, NextFunction } from "express";
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

    async detail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const result = await productInventoryRepository.getDetail(String(req.params.id), salonId);
            if (!result) { next(new AppError(404, "Product not found", "PRODUCT_NOT_FOUND")); return; }
            sendSuccess(res, 200, result, "Product detail fetched");
        } catch (err) {
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
