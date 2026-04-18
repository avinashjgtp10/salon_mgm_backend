"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
    /**
     * PATCH /api/v1/users/me
     * The authenticated user updates their own profile
     */
    async updateMe(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("PATCH /users/me called", {
                userId,
                method: req.method,
                path: req.originalUrl,
            });
            if (!userId) {
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            }
            const updated = await users_service_1.usersService.update(userId, req.body);
            logger_1.default.info("PATCH /users/me success", {
                userId,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Profile updated successfully");
        }
        catch (error) {
            logger_1.default.error("PATCH /users/me error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
    /**
     * POST /api/v1/users/me/change-password
     * Authenticated user changes their own password.
     */
    async changePassword(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("POST /users/me/change-password called", { userId });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const { currentPassword, newPassword } = req.body;
            await users_service_1.usersService.changePassword(userId, currentPassword, newPassword);
            logger_1.default.info("POST /users/me/change-password success", { userId });
            return (0, response_util_1.sendSuccess)(res, 200, null, "Password changed successfully");
        }
        catch (error) {
            logger_1.default.error("POST /users/me/change-password error", { error });
            return next(error);
        }
    },
    /**
     * POST /api/v1/users/me/avatar
     * Upload profile picture — file processed by multer, then stored to S3 (or local)
     */
    async uploadAvatar(req, res, next) {
        try {
            const userId = req.user?.userId;
            logger_1.default.info("POST /users/me/avatar called", {
                userId,
                method: req.method,
                path: req.originalUrl,
            });
            if (!userId) {
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            }
            const file = req.file;
            if (!file) {
                throw new error_middleware_1.AppError(400, "No image file provided", "FILE_REQUIRED");
            }
            const { uploadAvatarToS3 } = await Promise.resolve().then(() => __importStar(require("../utils/avatar.upload")));
            const avatarUrl = await uploadAvatarToS3(file.path, userId, file.mimetype);
            // Persist the URL in the DB
            const updated = await users_service_1.usersService.update(userId, { avatarUrl });
            logger_1.default.info("POST /users/me/avatar success", {
                userId,
                avatarUrl,
                method: req.method,
                path: req.originalUrl,
            });
            return (0, response_util_1.sendSuccess)(res, 200, { avatarUrl: updated.avatarUrl }, "Avatar updated successfully");
        }
        catch (error) {
            logger_1.default.error("POST /users/me/avatar error", {
                method: req.method,
                path: req.originalUrl,
                error,
            });
            return next(error);
        }
    },
};
//# sourceMappingURL=users.controller.js.map