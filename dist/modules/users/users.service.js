"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const error_middleware_1 = require("../../middleware/error.middleware");
const users_repository_1 = require("./users.repository");
const logger_1 = __importDefault(require("../../config/logger"));
function toSafeUser(u) {
    // Build fullName from full_name or first_name + last_name
    const fullName = (u.full_name?.trim()) ||
        [u.first_name, u.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() ||
        "";
    return {
        id: u.id,
        email: u.email,
        phone: u.phone ?? null,
        firstName: u.first_name ?? "",
        lastName: u.last_name ?? null,
        fullName,
        role: u.role,
        avatarUrl: u.avatar_url ?? null,
        isVerified: u.is_verified ?? false,
        isActive: u.is_active ?? true,
        lastLogin: u.last_login ?? null,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        // profile fields
        businessName: u.business_name ?? null,
        address: u.address ?? null,
        country: u.country ?? null,
        countryCode: u.country_code ?? null,
        isOnboardingComplete: u.is_onboarding_complete ?? false,
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
            updates["last_name"] = input.lastName?.trim() || null;
        // Rebuild full_name when either name part changes
        if (input.firstName !== undefined || input.lastName !== undefined) {
            const first = (input.firstName ?? "").trim();
            const last = (input.lastName ?? "").trim();
            updates["full_name"] = [first, last].filter(Boolean).join(" ") || first;
        }
        if (input.phone !== undefined)
            updates["phone"] = input.phone || null;
        if (input.avatarUrl !== undefined)
            updates["avatar_url"] = input.avatarUrl;
        if (input.isActive !== undefined)
            updates["is_active"] = input.isActive;
        if (input.role !== undefined)
            updates["role"] = input.role;
        // Profile fields
        if (input.businessName !== undefined)
            updates["business_name"] = input.businessName || null;
        if (input.address !== undefined)
            updates["address"] = input.address || null;
        if (input.country !== undefined)
            updates["country"] = input.country || null;
        if (input.countryCode !== undefined)
            updates["country_code"] = input.countryCode || null;
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
    async changePassword(userId, currentPassword, newPassword) {
        logger_1.default.info(`Changing password`, { userId });
        const user = await users_repository_1.usersRepo.findById(userId);
        if (!user)
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        const isMatch = await bcrypt_1.default.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            throw new error_middleware_1.AppError(400, "Current password is incorrect", "INVALID_PASSWORD");
        }
        const hash = await bcrypt_1.default.hash(newPassword, 12);
        await users_repository_1.usersRepo.updateById(userId, { password_hash: hash });
        logger_1.default.info(`Password changed successfully`, { userId });
    },
};
//# sourceMappingURL=users.service.js.map