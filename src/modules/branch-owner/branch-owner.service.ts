import jwt, { Secret } from "jsonwebtoken";
import { branchOwnerRepository } from "./branch-owner.repository";
import { superAdminRepository } from "../super-admin/super-admin.repository";
import { AppError } from "../../middleware/error.middleware";

const ACCESS_SECRET: Secret = process.env.JWT_ACCESS_SECRET || "";

export const branchOwnerService = {

  async getMySalons(branchOwnerId: string) {
    return branchOwnerRepository.getMySalons(branchOwnerId);
  },

  async enterSalon(branchOwnerId: string, salonId: string) {
    const isAssigned = await branchOwnerRepository.isSalonAssignedToBranchOwner(branchOwnerId, salonId);
    if (!isAssigned) throw new AppError(403, "Salon not assigned to you", "FORBIDDEN");

    const ownerId = await superAdminRepository.getSalonOwnerId(salonId);
    if (!ownerId) throw new AppError(404, "Salon or owner not found", "NOT_FOUND");
    if (!ACCESS_SECRET) throw new AppError(500, "JWT config missing", "SERVER_ERROR");

    const token = jwt.sign(
      { userId: ownerId, role: "salon_owner", salonId, impersonatedBy: "branch_owner" },
      ACCESS_SECRET,
      { expiresIn: "1h" } as any
    );
    return { token, isOnboardingComplete: true };
  },

};
