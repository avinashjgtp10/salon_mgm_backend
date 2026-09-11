import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { categoriesRepository } from "./categories.repository";
import { CreateCategoryBody, ServiceCategory, UpdateCategoryBody } from "./categories.types";

// Previously resolved salonId via salonsRepository.findByOwnerId(userId) —
// that only ever succeeds for the actual salon owner, so every staff/
// manager request landed on "Salon not found for this user" regardless of
// permissions. salonId is already on the JWT (req.user.salonId, set at
// login for owner and staff alike) — every other module (products,
// services, ...) reads it directly instead of doing an owner lookup; this
// module now does the same.
export const categoriesService = {
  async create(params: { salonId: string; body: CreateCategoryBody }): Promise<ServiceCategory> {
    const { salonId, body } = params;

    logger.info("categoriesService.create called", { salonId });

    return categoriesRepository.create(salonId, body);
  },

  async listMySalonCategories(params: { salonId: string }): Promise<ServiceCategory[]> {
    const { salonId } = params;

    return categoriesRepository.listBySalonId(salonId);
  },

  async getByIdForMySalon(params: { salonId: string; id: string }): Promise<ServiceCategory> {
    const { salonId, id } = params;

    const cat = await categoriesRepository.findByIdInSalon(id, salonId);
    if (!cat) throw new AppError(404, "Category not found", "NOT_FOUND");

    return cat;
  },

  async updateForMySalon(params: { salonId: string; id: string; patch: UpdateCategoryBody }): Promise<ServiceCategory> {
    const { salonId, id, patch } = params;

    const updated = await categoriesRepository.update(id, salonId, patch);
    if (!updated) throw new AppError(404, "Category not found", "NOT_FOUND");

    return updated;
  },

  async removeForMySalon(params: { salonId: string; id: string }): Promise<{ id: string; deleted: true }> {
    const { salonId, id } = params;

    const deleted = await categoriesRepository.remove(id, salonId);
    if (!deleted) throw new AppError(404, "Category not found", "NOT_FOUND");

    return { id: deleted.id, deleted: true };
  },
};