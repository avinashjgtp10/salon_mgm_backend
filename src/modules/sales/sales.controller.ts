import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { salesService } from "./sales.service";
import { CreateSaleBody, UpdateSaleBody, CheckoutSaleBody } from "./sales.types";
import { getSalonId } from "../utils/tenant.util";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const salesController = {
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const salonId = getSalonId(req);
            const body = req.body as Omit<CreateSaleBody, "salon_id">;
            const result = await salesService.create({
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: { ...body, salon_id: salonId },
            });
            return sendSuccess(res, 201, result, "Sale created successfully");
        } catch (err) { return next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = req.params.id as string;
            const result = await salesService.getById(id);
            return sendSuccess(res, 200, result, "Sale fetched successfully");
        } catch (err) { return next(err); }
    },

    async getInit(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const result = await salesService.init(salonId);
            return sendSuccess(res, 200, result, "Quick sale init data fetched successfully");
        } catch (err) { return next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const sales = await salesService.list({
                salon_id: salonId,
                client_id: req.query.client_id as string,
                status: req.query.status as string,
            });
            return sendSuccess(res, 200, sales, "Sales fetched successfully");
        } catch (err) { return next(err); }
    },

    async getDailySummary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const { date } = req.query;
            if (!date) throw new AppError(400, "date query parameter is required", "VALIDATION_ERROR");
            const summary = await salesService.getDailySummary(salonId, date as string);
            return sendSuccess(res, 200, summary, "Daily summary fetched successfully");
        } catch (err) { return next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = req.params.id as string;
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const sale = await salesService.update({
                id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                patch: req.body as UpdateSaleBody,
            });
            return sendSuccess(res, 200, sale, "Sale updated successfully");
        } catch (err) { return next(err); }
    },

    async checkout(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = req.params.id as string;
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const sale = await salesService.checkout({
                id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body as CheckoutSaleBody,
            });
            return sendSuccess(res, 200, sale, "Sale checked out successfully");
        } catch (err) { return next(err); }
    },

    async exportSales(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const rawFormat = req.query.format as string;
            const format: "csv" | "excel" | "pdf" =
                rawFormat === "pdf" ? "pdf" : rawFormat === "excel" ? "excel" : "csv";

            const { buffer, contentType, filename } = await salesService.exportSales({
                salon_id: salonId,
                status: req.query.status as string | undefined,
                date: req.query.date as string | undefined,
                format,
            });
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Content-Type", contentType);
            return res.send(buffer);
        } catch (err) { return next(err); }
    }
};
