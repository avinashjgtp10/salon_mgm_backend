import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { supplierProductsService } from "./supplier-products.service";
import { ResolveSupplierProductBody } from "./supplier-products.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const supplierProductsController = {
    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const rows = await supplierProductsService.list(String(req.params.id), salonId, {
                matched_only: req.query.matched_only === "true",
            });
            sendSuccess(res, 200, rows, "Supplier catalog fetched");
        } catch (err) { next(err); }
    },

    async import(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "No file uploaded", "VALIDATION_ERROR");
            logger.info("POST /inventory/suppliers/:id/products/import called", { salonId, supplierId: req.params.id });
            const result = await supplierProductsService.import({
                supplierId: String(req.params.id), salonId, file: file.buffer, filename: file.originalname,
            });
            sendSuccess(res, 200, result, `Import completed: ${result.matched} matched, ${result.unmatched} unmatched, ${result.failed} failed`);
        } catch (err) { next(err); }
    },

    async resolve(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const row = await supplierProductsService.resolve({
                catalogId: String(req.params.catalogId), salonId, body: req.body as ResolveSupplierProductBody,
            });
            sendSuccess(res, 200, row, "Catalog row resolved");
        } catch (err) { next(err); }
    },
};
