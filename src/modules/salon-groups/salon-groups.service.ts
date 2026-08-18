import { AppError } from "../../middleware/error.middleware";
import { salonGroupsRepository } from "./salon-groups.repository";

export const salonGroupsService = {
  async list(search?: string) {
    return salonGroupsRepository.list(search);
  },

  async create(name: string, ownerId: string) {
    if (!name?.trim()) throw new AppError(400, "Group name is required", "VALIDATION_ERROR");
    if (!ownerId) throw new AppError(400, "owner_id is required", "VALIDATION_ERROR");
    const { id } = await salonGroupsRepository.create(name.trim(), ownerId);
    const group = await salonGroupsRepository.getById(id);
    if (!group) throw new AppError(500, "Failed to create group", "SERVER_ERROR");
    return group;
  },

  async delete(groupId: string) {
    const memberCount = await salonGroupsRepository.countMembers(groupId);
    if (memberCount > 0) {
      throw new AppError(409, "Remove all salons from this group before deleting it", "GROUP_NOT_EMPTY");
    }
    const deleted = await salonGroupsRepository.delete(groupId);
    if (!deleted) throw new AppError(404, "Salon group not found", "NOT_FOUND");
    return { id: groupId };
  },

  async addSalon(groupId: string, salonId: string) {
    const groupOwnerId = await salonGroupsRepository.getOwnerId(groupId);
    if (!groupOwnerId) throw new AppError(404, "Salon group not found", "NOT_FOUND");

    const salonOwnerId = await salonGroupsRepository.getSalonOwnerId(salonId);
    if (!salonOwnerId) throw new AppError(404, "Salon not found", "NOT_FOUND");

    if (salonOwnerId !== groupOwnerId) {
      throw new AppError(403, "This salon is not owned by the group's owner", "OWNER_MISMATCH");
    }

    const existingGroupId = await salonGroupsRepository.getExistingGroupIdForSalon(salonId);
    if (existingGroupId) {
      throw new AppError(409, "This salon already belongs to a group", "ALREADY_GROUPED");
    }

    await salonGroupsRepository.addSalon(groupId, salonId);
    const group = await salonGroupsRepository.getById(groupId);
    if (!group) throw new AppError(500, "Failed to load updated group", "SERVER_ERROR");
    return group;
  },

  async removeSalon(groupId: string, salonId: string) {
    const removed = await salonGroupsRepository.removeSalon(groupId, salonId);
    if (!removed) throw new AppError(404, "This salon is not in that group", "NOT_FOUND");
    const group = await salonGroupsRepository.getById(groupId);
    if (!group) throw new AppError(404, "Salon group not found", "NOT_FOUND");
    return group;
  },

  async getUngroupedSalonsForOwner(ownerId: string) {
    if (!ownerId) throw new AppError(400, "owner_id is required", "VALIDATION_ERROR");
    return salonGroupsRepository.getUngroupedSalonsForOwner(ownerId);
  },

  // Provisions/resets the branch-owner login (email + password) for a
  // group's owner. Same salon_owner account used by the regular dashboard —
  // this just gives Super Admin an explicit way to hand out a distinct
  // credential for the /group-admin portal rather than relying on the
  // owner's pre-existing password.
  async setCredentials(groupId: string, email: string, password: string) {
    if (!email?.trim()) throw new AppError(400, "Email is required", "VALIDATION_ERROR");
    if (!password || password.length < 6) throw new AppError(400, "Password must be at least 6 characters", "VALIDATION_ERROR");

    const ownerId = await salonGroupsRepository.getOwnerId(groupId);
    if (!ownerId) throw new AppError(404, "Salon group not found", "NOT_FOUND");

    const normalizedEmail = email.trim().toLowerCase();
    const conflict = await salonGroupsRepository.findUserByEmailExcluding(normalizedEmail, ownerId);
    if (conflict) throw new AppError(409, "That email is already in use by another account", "DUPLICATE_ENTRY");

    await salonGroupsRepository.setOwnerCredentials(ownerId, normalizedEmail, password);
    const group = await salonGroupsRepository.getById(groupId);
    if (!group) throw new AppError(500, "Failed to load updated group", "SERVER_ERROR");
    return group;
  },
};
