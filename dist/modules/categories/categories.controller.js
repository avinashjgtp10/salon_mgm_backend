"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriesController = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const logger_1 = __importDefault(require("../../config/logger"));
const categories_service_1 = require("./categories.service");
exports.categoriesController = {
    // POST /api/v1/categories
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("POST /categories called", { userId });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const body = req.body;
            const created = await categories_service_1.categoriesService.create({
                requesterUserId: userId,
                body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, created, "Category created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /categories error", { err });
            return next(err);
        }
    },
    // GET /api/v1/categories
    async list(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("GET /categories called", { userId });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const rows = await categories_service_1.categoriesService.listMySalonCategories({
                requesterUserId: userId,
            });
            return (0, response_util_1.sendSuccess)(res, 200, rows, "Categories fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /categories error", { err });
            return next(err);
        }
    },
    // GET /api/v1/categories/:id
    async getById(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /categories/:id called", { userId, id });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const cat = await categories_service_1.categoriesService.getByIdForMySalon({
                requesterUserId: userId,
                id,
            });
            return (0, response_util_1.sendSuccess)(res, 200, cat, "Category fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /categories/:id error", { err });
            return next(err);
        }
    },
    // PATCH /api/v1/categories/:id
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PATCH /categories/:id called", { userId, id });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const patch = req.body;
            const updated = await categories_service_1.categoriesService.updateForMySalon({
                requesterUserId: userId,
                id,
                patch,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Category updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /categories/:id error", { err });
            return next(err);
        }
    },
    // DELETE /api/v1/categories/:id
    async remove(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("DELETE /categories/:id called", { userId, id });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const result = await categories_service_1.categoriesService.removeForMySalon({
                requesterUserId: userId,
                id,
            });
            return (0, response_util_1.sendSuccess)(res, 200, result, "Category deleted successfully");
        }
        catch (err) {
            logger_1.default.error("DELETE /categories/:id error", { err });
            return next(err);
        }
    },
};
//# sourceMappingURL=categories.controller.js.map