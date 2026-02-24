import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";
import { salonsService } from "./salons.service";
import { CreateSalonBody, UpdateSalonBody } from "./salons.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string };
};

export const salonsController = {
    // POST /api/v1/salons
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;

            logger.info("POST /salons called", {
                userId,
                role,
                path: req.originalUrl,
                method: req.method,
            });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const body = req.body as CreateSalonBody;
            const salon = await salonsService.create(userId, body);

            logger.info("POST /salons success", {
                userId,
                salonId: salon.id,
                slug: salon.slug,
            });

            return sendSuccess(res, 201, salon, "Salon created successfully");
        } catch (err) {
            logger.error("POST /salons error", { err });
            return next(err);
        }
    },

    // GET /api/v1/salons/me
    async mySalon(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;

            logger.info("GET /salons/me called", {
                userId,
                path: req.originalUrl,
                method: req.method,
            });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const salon = await salonsService.mySalon(userId);

            logger.info("GET /salons/me success", {
                userId,
                salonId: salon.id,
            });

            return sendSuccess(res, 200, salon, "Salon fetched successfully");
        } catch (err) {
            logger.error("GET /salons/me error", { err });
            return next(err);
        }
    },

    // GET /api/v1/salons/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();

            logger.info("GET /salons/:id called", {
                salonId: id,
                path: req.originalUrl,
                method: req.method,
            });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const salon = await salonsService.getById(id);

            logger.info("GET /salons/:id success", {
                salonId: salon.id,
            });

            return sendSuccess(res, 200, salon, "Salon fetched successfully");
        } catch (err) {
            logger.error("GET /salons/:id error", { err });
            return next(err);
        }
    },

    // GET /api/v1/salons (admin)
    async listAll(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            logger.info("GET /salons called", {
                requesterUserId: req.user?.userId,
                requesterRole: req.user?.role,
                path: req.originalUrl,
                method: req.method,
            });

            const salons = await salonsService.listAll();

            logger.info("GET /salons success", {
                count: salons.length,
            });

            return sendSuccess(res, 200, salons, "Salons list fetched successfully");
        } catch (err) {
            logger.error("GET /salons error", { err });
            return next(err);
        }
    },

    // PATCH /api/v1/salons/:id
    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();

            logger.info("PATCH /salons/:id called", {
                salonId: id,
                requesterUserId: userId,
                requesterRole: role,
                path: req.originalUrl,
                method: req.method,
            });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const patch = req.body as UpdateSalonBody;

            const updated = await salonsService.updateByOwnerOrAdmin({
                salonId: id,
                requesterUserId: userId,
                requesterRole: role,
                patch,
            });

            logger.info("PATCH /salons/:id success", {
                salonId: updated.id,
                slug: updated.slug,
            });

            return sendSuccess(res, 200, updated, "Salon updated successfully");
        } catch (err) {
            logger.error("PATCH /salons/:id error", { err });
            return next(err);
        }
    },
};
