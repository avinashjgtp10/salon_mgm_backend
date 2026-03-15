"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.salonsController = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const logger_1 = __importDefault(require("../../config/logger"));
const salons_service_1 = require("./salons.service");
exports.salonsController = {
    // POST /api/v1/salons
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /salons called", {
                userId,
                role,
                path: req.originalUrl,
                method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const body = req.body;
            const salon = await salons_service_1.salonsService.create(userId, body);
            logger_1.default.info("POST /salons success", {
                userId,
                salonId: salon.id,
                slug: salon.slug,
            });
            return (0, response_util_1.sendSuccess)(res, 201, salon, "Salon created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /salons error", { err });
            return next(err);
        }
    },
    // GET /api/v1/salons/me
    async mySalon(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("GET /salons/me called", {
                userId,
                path: req.originalUrl,
                method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const salon = await salons_service_1.salonsService.mySalon(userId);
            logger_1.default.info("GET /salons/me success", {
                userId,
                salonId: salon.id,
            });
            return (0, response_util_1.sendSuccess)(res, 200, salon, "Salon fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /salons/me error", { err });
            return next(err);
        }
    },
    // GET /api/v1/salons/:id
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /salons/:id called", {
                salonId: id,
                path: req.originalUrl,
                method: req.method,
            });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const salon = await salons_service_1.salonsService.getById(id);
            logger_1.default.info("GET /salons/:id success", {
                salonId: salon.id,
            });
            return (0, response_util_1.sendSuccess)(res, 200, salon, "Salon fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /salons/:id error", { err });
            return next(err);
        }
    },
    // GET /api/v1/salons (admin)
    async listAll(req, res, next) {
        try {
            logger_1.default.info("GET /salons called", {
                requesterUserId: req.user?.userId,
                requesterRole: req.user?.role,
                path: req.originalUrl,
                method: req.method,
            });
            const salons = await salons_service_1.salonsService.listAll();
            logger_1.default.info("GET /salons success", {
                count: salons.length,
            });
            return (0, response_util_1.sendSuccess)(res, 200, salons, "Salons list fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /salons error", { err });
            return next(err);
        }
    },
    // PATCH /api/v1/salons/:id
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PATCH /salons/:id called", {
                salonId: id,
                requesterUserId: userId,
                requesterRole: role,
                path: req.originalUrl,
                method: req.method,
            });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const patch = req.body;
            const updated = await salons_service_1.salonsService.updateByOwnerOrAdmin({
                salonId: id,
                requesterUserId: userId,
                requesterRole: role,
                patch,
            });
            logger_1.default.info("PATCH /salons/:id success", {
                salonId: updated.id,
                slug: updated.slug,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Salon updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /salons/:id error", { err });
            return next(err);
        }
    },
};
//# sourceMappingURL=salons.controller.js.map