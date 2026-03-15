"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersService = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const users_repository_1 = require("./users.repository");
const logger_1 = __importDefault(require("../../config/logger"));
function toSafeUser(u) {
    return {
        id: u.id,
        email: u.email,
        phone: u.phone,
        firstName: u.first_name,
        lastName: u.last_name,
        role: u.role,
        avatarUrl: u.avatar_url,
        isVerified: u.is_verified,
        isActive: u.is_active,
        lastLogin: u.last_login,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
    };
}
exports.usersService = {
    async me(userId) {
        logger_1.default.info(`Fetching current user profile`, { userId });
        const user = await users_repository_1.usersRepo.findById(userId);
        if (!user) {
            logger_1.default.warn(`User not found`, { userId });
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        }
        logger_1.default.info(`User profile fetched successfully`, { userId });
        return toSafeUser(user);
    },
    async list() {
        logger_1.default.info(`Fetching all users`);
        const users = await users_repository_1.usersRepo.findAll();
        logger_1.default.info(`Users fetched`, { count: users.length });
        return users.map(toSafeUser);
    },
    async getById(id) {
        logger_1.default.info(`Fetching user by id`, { id });
        const user = await users_repository_1.usersRepo.findById(id);
        if (!user) {
            logger_1.default.warn(`User not found`, { id });
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        }
        return toSafeUser(user);
    },
    async update(id, input) {
        logger_1.default.info(`Updating user`, { id });
        const updates = {};
        if (input.firstName !== undefined)
            updates["first_name"] = input.firstName.trim();
        if (input.lastName !== undefined)
            updates["last_name"] = input.lastName.trim();
        if (input.phone !== undefined)
            updates["phone"] = input.phone;
        if (input.avatarUrl !== undefined)
            updates["avatar_url"] = input.avatarUrl;
        if (input.isActive !== undefined)
            updates["is_active"] = input.isActive;
        if (input.role !== undefined)
            updates["role"] = input.role;
        const updated = await users_repository_1.usersRepo.updateById(id, updates);
        if (!updated) {
            logger_1.default.warn(`User update failed - not found`, { id });
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        }
        logger_1.default.info(`User updated successfully`, { id });
        return toSafeUser(updated);
    },
    async remove(id) {
        logger_1.default.info(`Deleting user`, { id });
        const ok = await users_repository_1.usersRepo.deleteById(id);
        if (!ok) {
            logger_1.default.warn(`Delete failed - user not found`, { id });
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        }
        logger_1.default.info(`User deleted successfully`, { id });
        return true;
    },
};
//# sourceMappingURL=users.service.js.map