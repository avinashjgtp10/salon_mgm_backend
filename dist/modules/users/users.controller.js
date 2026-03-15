"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersController = void 0;
const users_service_1 = require("./users.service");
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const logger_1 = __importDefault(require("../../config/logger"));
const getParamString = (value) => {
    if (typeof value === "string" && value.trim())
        return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim())
        return value[0].trim();
    return null;
};
exports.usersController = {
    /**
     * GET /api/v1/users/me
     * Protected
     */
    async me(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("GET /users/me called", {
                userId,
                method: req.method,
                path: req.originalUrl,
            });
            if (!userId) {
                logger_1.default.warn("GET /users/me unauthorized (missing req.user.userId)", {
                    method: req.method,
                    path: req.originalUrl,
                });
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            }
            const user = await users_service_1.usersService.me(userId);
            logger_1.default.info("GET /users/me success", {
                userId,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, user, "User profile fetched successfully");
        }
        catch (error) {
            logger_1.default.error("GET /users/me error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
    /**
     * GET /api/v1/users
     * Protected (admin in your route middleware)
     */
    async list(req, res, next) {
        try {
            logger_1.default.info("GET /users called", {
                method: req.method,
                path: req.originalUrl,
            });
            const users = await users_service_1.usersService.list();
            logger_1.default.info("GET /users success", {
                count: Array.isArray(users) ? users.length : undefined,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, users, "Users fetched successfully");
        }
        catch (error) {
            logger_1.default.error("GET /users error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
    /**
 * PATCH /api/v1/users/:id/role
 * Protected (admin only in routes)
 */
    async updateRole(req, res, next) {
        try {
            const id = getParamString(req.params.id);
            const role = typeof req.body?.role === "string" ? req.body.role.trim() : "";
            logger_1.default.info("PATCH /users/:id/role called", {
                id,
                byUserId: req.user?.userId,
                byRole: req.user?.role,
                method: req.method,
                path: req.originalUrl,
            });
            if (!id) {
                logger_1.default.warn("PATCH /users/:id/role validation failed (missing id)", {
                    method: req.method,
                    path: req.originalUrl,
                });
                throw new error_middleware_1.AppError(400, "User id is required", "USER_ID_REQUIRED");
            }
            if (!role) {
                logger_1.default.warn("PATCH /users/:id/role validation failed (missing role)", {
                    id,
                    method: req.method,
                    path: req.originalUrl,
                });
                throw new error_middleware_1.AppError(400, "role is required", "ROLE_REQUIRED");
            }
            // ✅ only update role (no other fields)
            const updated = await users_service_1.usersService.update(id, { role });
            logger_1.default.info("PATCH /users/:id/role success", {
                id,
                newRole: role,
                method: req.method,
                path: req.originalUrl,
            });
            // ✅ uses your sendSuccess (responses.js style)
            return (0, response_util_1.sendSuccess)(res, 200, updated, "User role updated successfully");
        }
        catch (error) {
            logger_1.default.error("PATCH /users/:id/role error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
    /**
     * GET /api/v1/users/:id
     * Protected
     */
    async getById(req, res, next) {
        try {
            const id = getParamString(req.params.id);
            logger_1.default.info("GET /users/:id called", {
                id,
                method: req.method,
                path: req.originalUrl,
            });
            if (!id) {
                logger_1.default.warn("GET /users/:id validation failed (missing id)", {
                    method: req.method,
                    path: req.originalUrl,
                });
                throw new error_middleware_1.AppError(400, "User id is required", "USER_ID_REQUIRED");
            }
            const user = await users_service_1.usersService.getById(id);
            logger_1.default.info("GET /users/:id success", {
                id,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, user, "User fetched successfully");
        }
        catch (error) {
            logger_1.default.error("GET /users/:id error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
    /**
     * PATCH /api/v1/users/:id
     * Protected
     */
    async update(req, res, next) {
        try {
            const id = getParamString(req.params.id);
            logger_1.default.info("PATCH /users/:id called", {
                id,
                method: req.method,
                path: req.originalUrl,
            });
            if (!id) {
                logger_1.default.warn("PATCH /users/:id validation failed (missing id)", {
                    method: req.method,
                    path: req.originalUrl,
                });
                throw new error_middleware_1.AppError(400, "User id is required", "USER_ID_REQUIRED");
            }
            const updated = await users_service_1.usersService.update(id, req.body);
            logger_1.default.info("PATCH /users/:id success", {
                id,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "User updated successfully");
        }
        catch (error) {
            logger_1.default.error("PATCH /users/:id error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
    /**
     * DELETE /api/v1/users/:id
     * Protected
     */
    async remove(req, res, next) {
        try {
            const id = getParamString(req.params.id);
            logger_1.default.info("DELETE /users/:id called", {
                id,
                method: req.method,
                path: req.originalUrl,
            });
            if (!id) {
                logger_1.default.warn("DELETE /users/:id validation failed (missing id)", {
                    method: req.method,
                    path: req.originalUrl,
                });
                throw new error_middleware_1.AppError(400, "User id is required", "USER_ID_REQUIRED");
            }
            const result = await users_service_1.usersService.remove(id);
            logger_1.default.info("DELETE /users/:id success", {
                id,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, result, "User deleted successfully");
            // Strict REST option:
            // return res.sendStatus(204);
        }
        catch (error) {
            logger_1.default.error("DELETE /users/:id error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
};
//# sourceMappingURL=users.controller.js.map