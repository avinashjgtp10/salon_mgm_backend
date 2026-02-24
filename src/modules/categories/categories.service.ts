import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "../salons/salons.repository";
import { categoriesRepository } from "./categories.repository";
import { CreateCategoryBody, ServiceCategory, UpdateCategoryBody } from "./categories.types";

export const categoriesService = {
  async getMySalonId(ownerId: string): Promise<string> {
    const salon = await salonsRepository.findByOwnerId(ownerId);
    if (!salon) throw new AppError(404, "Salon not found for this user", "NOT_FOUND");
    return salon.id;
  },

  async create(params: { requesterUserId: string; body: CreateCategoryBody }): Promise<ServiceCategory> {
    const { requesterUserId, body } = params;

    logger.info("categoriesService.create called", { requesterUserId });

    const salonId = await this.getMySalonId(requesterUserId);
    return categoriesRepository.create(salonId, body);
  },

  async listMySalonCategories(params: { requesterUserId: string }): Promise<ServiceCategory[]> {
    const { requesterUserId } = params;

    const salonId = await this.getMySalonId(requesterUserId);
    return categoriesRepository.listBySalonId(salonId);
  },

  async getByIdForMySalon(params: { requesterUserId: string; id: string }): Promise<ServiceCategory> {
    const { requesterUserId, id } = params;

    const salonId = await this.getMySalonId(requesterUserId);

    const cat = await categoriesRepository.findByIdInSalon(id, salonId);
    if (!cat) throw new AppError(404, "Category not found", "NOT_FOUND");

    return cat;
  },

  async updateForMySalon(params: { requesterUserId: string; id: string; patch: UpdateCategoryBody }): Promise<ServiceCategory> {
    const { requesterUserId, id, patch } = params;

    const salonId = await this.getMySalonId(requesterUserId);

    const updated = await categoriesRepository.update(id, salonId, patch);
    if (!updated) throw new AppError(404, "Category not found", "NOT_FOUND");

    return updated;
  },

  async removeForMySalon(params: { requesterUserId: string; id: string }): Promise<{ id: string; deleted: true }> {
    const { requesterUserId, id } = params;

    const salonId = await this.getMySalonId(requesterUserId);

    const deleted = await categoriesRepository.remove(id, salonId);
    if (!deleted) throw new AppError(404, "Category not found", "NOT_FOUND");

    return { id: deleted.id, deleted: true };
  },
};