"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileController = void 0;
const users_service_1 = require("../users/users.service");
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const logger_1 = __importDefault(require("../../config/logger"));
exports.profileController = {
    /**
     * GET /api/v1/profile/:id
     * Authenticated user can fetch own profile; admin can fetch any.
     */
    async getProfile(req, res, next) {
        try {
            const id = req.params.id;
            const requesterId = req.user?.userId;
            const requesterRole = req.user?.role;
            logger_1.default.info("GET /profile/:id called", { id, requesterId });
            if (!requesterId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (id !== requesterId && requesterRole !== "admin") {
                throw new error_middleware_1.AppError(403, "Access denied", "FORBIDDEN");
            }
            const user = await users_service_1.usersService.getById(id);
            logger_1.default.info("GET /profile/:id success", { id });
            return (0, response_util_1.sendSuccess)(res, 200, user, "Profile fetched successfully");
        }
        catch (error) {
            logger_1.default.error("GET /profile/:id error", { error });
            return next(error);
        }
    },
    /**
     * PUT /api/v1/profile/:id
     * Authenticated user can update own profile; admin can update any.
     * Body is pre-validated by validateBody(updateProfileBodySchema).
     */
    async updateProfile(req, res, next) {
        try {
            const id = req.params.id;
            const requesterId = req.user?.userId;
            const requesterRole = req.user?.role;
            logger_1.default.info("PUT /profile/:id called", { id, requesterId });
            if (!requesterId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (id !== requesterId && requesterRole !== "admin") {
                throw new error_middleware_1.AppError(403, "Access denied", "FORBIDDEN");
            }
            const updated = await users_service_1.usersService.update(id, req.body);
            logger_1.default.info("PUT /profile/:id success", { id });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Profile updated successfully");
        }
        catch (error) {
            logger_1.default.error("PUT /profile/:id error", { error });
            return next(error);
        }
    },
};
//# sourceMappingURL=profile.controller.js.map