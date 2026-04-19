import bcrypt from "bcrypt";
import { AppError } from "../../middleware/error.middleware";
import { usersRepo } from "./users.repository";
import { SafeUser, UpdateUserInput } from "./users.types";
import logger from "../../config/logger";

function toSafeUser(u: any): SafeUser {
  // Build fullName from full_name or first_name + last_name
  const fullName =
    (u.full_name?.trim()) ||
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

export const usersService = {

  async me(userId: string) {
    logger.info(`Fetching current user profile`, { userId });

    const user = await usersRepo.findById(userId);

    if (!user) {
      logger.warn(`User not found`, { userId });
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    logger.info(`User profile fetched successfully`, { userId });
    return toSafeUser(user);
  },

  async list() {
    logger.info(`Fetching all users`);

    const users = await usersRepo.findAll();

    logger.info(`Users fetched`, { count: users.length });

    return users.map(toSafeUser);
  },

  async getById(id: string) {
    logger.info(`Fetching user by id`, { id });

    const user = await usersRepo.findById(id);

    if (!user) {
      logger.warn(`User not found`, { id });
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    return toSafeUser(user);
  },

  async update(id: string, input: UpdateUserInput) {
    logger.info(`Updating user`, { id });

    const updates: Record<string, any> = {};

    if (input.firstName !== undefined)
      updates["first_name"] = input.firstName.trim();

    if (input.lastName !== undefined)
      updates["last_name"] = input.lastName?.trim() || null;

    // Rebuild full_name when either name part changes
    if (input.firstName !== undefined || input.lastName !== undefined) {
      const first = (input.firstName ?? "").trim();
      const last  = (input.lastName  ?? "").trim();
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
    if ((input as any).businessName !== undefined)
      updates["business_name"] = (input as any).businessName || null;

    if ((input as any).address !== undefined)
      updates["address"] = (input as any).address || null;

    if ((input as any).country !== undefined)
      updates["country"] = (input as any).country || null;

    if ((input as any).countryCode !== undefined)
      updates["country_code"] = (input as any).countryCode || null;

    const updated = await usersRepo.updateById(id, updates);

    if (!updated) {
      logger.warn(`User update failed - not found`, { id });
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    logger.info(`User updated successfully`, { id });

    return toSafeUser(updated);
  },

  async remove(id: string) {
    logger.info(`Deleting user`, { id });

    const ok = await usersRepo.deleteById(id);

    if (!ok) {
      logger.warn(`Delete failed - user not found`, { id });
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    logger.info(`User deleted successfully`, { id });

    return true;
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    logger.info(`Changing password`, { userId });

    const user = await usersRepo.findById(userId);
    if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      throw new AppError(400, "Current password is incorrect", "INVALID_PASSWORD");
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await usersRepo.updateById(userId, { password_hash: hash });

    logger.info(`Password changed successfully`, { userId });
  },
};
