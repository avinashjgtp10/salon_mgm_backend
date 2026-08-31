import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { productAuditService } from "./product-audit.service";
import { CreateProductAuditBody, ProductAuditStatus } from "./product-audit.types";

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

const asPositiveInt = (value: unknown, fallback: number): number => {
    const n = parseInt(String(value ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const productAuditController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            logger.info("POST /inventory/product-audits called", { userId, salonId, path: req.originalUrl });

            const audit = await productAuditService.create({
                salonId, auditorId: userId, body: req.body as CreateProductAuditBody,
            });
            sendSuccess(res, 201, audit, "Product audit created successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const result = await productAuditService.list({
                branch_id: (req.query.branch_id as string) || undefined,
                status: (req.query.status as ProductAuditStatus) || undefined,
                search: (req.query.search as string) || undefined,
                page: asPositiveInt(req.query.page, 1),
                limit: asPositiveInt(req.query.limit, 20),
            }, salonId);
            sendSuccess(res, 200, result, "Product audits fetched successfully");
        } catch (err) { next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const audit = await productAuditService.getById(String(req.params.id), salonId);
            sendSuccess(res, 200, audit, "Product audit fetched successfully");
        } catch (err) { next(err); }
    },

    async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            await productAuditService.delete(String(req.params.id), salonId);
            sendSuccess(res, 200, null, "Product audit deleted successfully");
        } catch (err) { next(err); }
    },

    async addItems(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const audit = await productAuditService.addItems({
                auditId: String(req.params.id),
                salonId,
                productIds: Array.isArray(req.body.product_ids) ? req.body.product_ids : [],
            });
            sendSuccess(res, 200, audit, "Products added to audit");
        } catch (err) { next(err); }
    },

    async removeItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const audit = await productAuditService.removeItem({
                auditId: String(req.params.id),
                itemId: String(req.params.itemId),
                salonId,
            });
            sendSuccess(res, 200, audit, "Product removed from audit");
        } catch (err) { next(err); }
    },

    async updateItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const physicalQty = req.body.physical_qty === null || req.body.physical_qty === undefined
                ? null
                : Number(req.body.physical_qty);
            const audit = await productAuditService.updateItem({
                auditId: String(req.params.id),
                itemId: String(req.params.itemId),
                salonId,
                physicalQty,
                reason: req.body.reason ?? null,
            });
            sendSuccess(res, 200, audit, "Audit item updated");
        } catch (err) { next(err); }
    },

    async submitForReview(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            const audit = await productAuditService.submitForReview({
                auditId: String(req.params.id), salonId, actorId: userId,
            });
            sendSuccess(res, 200, audit, "Audit submitted for review");
        } catch (err) { next(err); }
    },

    async approve(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            const audit = await productAuditService.approve({
                auditId: String(req.params.id), salonId, reviewerId: userId,
                requestedReviewerId: req.body.reviewer_id || undefined,
            });
            sendSuccess(res, 200, audit, "Audit approved and completed");
        } catch (err) { next(err); }
    },

    async reject(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            const audit = await productAuditService.reject({
                auditId: String(req.params.id), salonId, reviewerId: userId, reason: String(req.body.reason || ""),
                requestedReviewerId: req.body.reviewer_id || undefined,
            });
            sendSuccess(res, 200, audit, "Audit rejected");
        } catch (err) { next(err); }
    },

    async reopen(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = getUserId(req);
            const audit = await productAuditService.reopen({
                auditId: String(req.params.id), salonId, actorId: userId,
            });
            sendSuccess(res, 200, audit, "Audit reopened for recount");
        } catch (err) { next(err); }
    },
};
