import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { uploadAvatarToS3 } from "../utils/avatar.upload";
import { ordersRepository } from "./orders.repository";
import { CreateOrderDTO, ReceiveOrderDTO } from "./orders.types";

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

export const ordersController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Authentication required", "NO_USER");

            const body = req.body as CreateOrderDTO;
            logger.info("POST /inventory/orders called", { salonId, userId, supplierId: body.supplier_id });

            const order = await ordersRepository.create(body, salonId, userId);
            sendSuccess(res, 201, order, "Order created successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const result = await ordersRepository.list(
                {
                    search: (req.query.search as string) || undefined,
                    page: asPositiveInt(req.query.page, 1),
                    limit: asPositiveInt(req.query.limit, 20),
                },
                salonId,
            );
            sendSuccess(res, 200, result);
        } catch (err) { next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const order = await ordersRepository.getById(String(req.params.id), salonId);
            if (!order) {
                next(new AppError(404, "Order not found", "ORDER_NOT_FOUND"));
                return;
            }
            sendSuccess(res, 200, order);
        } catch (err) { next(err); }
    },

    async receive(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Authentication required", "NO_USER");

            const body = req.body as ReceiveOrderDTO;
            logger.info("POST /inventory/orders/:id/receive called", { salonId, userId, orderId: req.params.id });

            const order = await ordersRepository.receive(String(req.params.id), body, salonId, userId);
            sendSuccess(res, 200, order, "Order received successfully");
        } catch (err) { next(err); }
    },

    async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const order = await ordersRepository.cancel(String(req.params.id), salonId);
            sendSuccess(res, 200, order, "Order cancelled");
        } catch (err) { next(err); }
    },

    /**
     * POST /inventory/orders/upload-signature
     * Uploads a signature image (multer → S3, or local /uploads fallback,
     * same as clients.controller.ts#uploadAvatar) and logs it into
     * order_signatures so it shows up in the "Gallery" picker too.
     */
    async uploadSignature(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Authentication required", "NO_USER");

            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "No image file provided", "FILE_REQUIRED");

            const key = `${salonId}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const url = await uploadAvatarToS3(file.path, key, file.mimetype, "order-signatures");
            const signature = await ordersRepository.addSignature(salonId, url, userId);

            sendSuccess(res, 200, signature, "Signature uploaded successfully");
        } catch (err) { next(err); }
    },

    // POST, not PUT/PATCH — matches this module's other mutating routes.
    async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const body = req.body as CreateOrderDTO;
            const order = await ordersRepository.update(String(req.params.id), body, salonId);
            if (!order) {
                next(new AppError(404, "Order not found", "ORDER_NOT_FOUND"));
                return;
            }
            sendSuccess(res, 200, order, "Order updated successfully");
        } catch (err) { next(err); }
    },

    async listSignatures(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const signatures = await ordersRepository.listSignatures(salonId);
            sendSuccess(res, 200, signatures);
        } catch (err) { next(err); }
    },

    // POST rather than DELETE — matches this module's other mutating routes
    // (create, uploadSignature) all being POST, so the order detail page's
    // "Delete" action doesn't need a different HTTP method wired through.
    async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const deleted = await ordersRepository.delete(String(req.params.id), salonId);
            if (!deleted) {
                next(new AppError(404, "Order not found", "ORDER_NOT_FOUND"));
                return;
            }
            sendSuccess(res, 200, null, "Order deleted successfully");
        } catch (err) { next(err); }
    },
};
