import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { productSuppliersRepository } from "./product-suppliers.repository";
import { AddProductSupplierBody, UpdateProductSupplierBody } from "./product-suppliers.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const productSuppliersController = {
    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const rows = await productSuppliersRepository.list(String(req.params.id), salonId);
            sendSuccess(res, 200, rows, "Product suppliers fetched");
        } catch (err) { next(err); }
    },

    async add(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const row = await productSuppliersRepository.add(
                String(req.params.id), salonId, req.body as AddProductSupplierBody,
            );
            sendSuccess(res, 201, row, "Supplier added");
        } catch (err) { next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const row = await productSuppliersRepository.update(
                String(req.params.mappingId), salonId, req.body as UpdateProductSupplierBody,
            );
            sendSuccess(res, 200, row, "Supplier updated");
        } catch (err) { next(err); }
    },

    async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            await productSuppliersRepository.remove(String(req.params.mappingId), salonId);
            sendSuccess(res, 200, null, "Supplier removed");
        } catch (err) { next(err); }
    },
};
