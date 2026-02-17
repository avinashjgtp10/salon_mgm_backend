import { AppError } from "../../middleware/error.middleware";
import { usersRepo } from "./users.repository";
import { SafeUser, UpdateUserInput } from "./users.types";
import logger from "../../config/logger";

function toSafeUser(u: any): SafeUser {
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
      updates["last_name"] = input.lastName.trim();

    if (input.phone !== undefined)
      updates["phone"] = input.phone;

    if (input.avatarUrl !== undefined)
      updates["avatar_url"] = input.avatarUrl;

    if (input.isActive !== undefined)
      updates["is_active"] = input.isActive;

    if (input.role !== undefined)
      updates["role"] = input.role;

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
};
