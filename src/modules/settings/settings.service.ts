import { AppError } from "../../middleware/error.middleware";
import { settingsRepository } from "./settings.repository";
import { CreateSettingBody, UpdateSettingBody, Setting } from "./settings.types";

export const settingsService = {
  async list(salonId: string): Promise<Setting[]> {
    return settingsRepository.findAll(salonId);
  },

  async getById(salonId: string, id: string): Promise<Setting> {
    const setting = await settingsRepository.findById(salonId, id);
    if (!setting) throw new AppError(404, "Setting not found", "NOT_FOUND");
    return setting;
  },

  async create(salonId: string, body: CreateSettingBody): Promise<Setting> {
    return settingsRepository.upsert(salonId, body);
  },

  async update(salonId: string, id: string, body: UpdateSettingBody): Promise<Setting> {
    const setting = await settingsRepository.update(salonId, id, body);
    if (!setting) throw new AppError(404, "Setting not found", "NOT_FOUND");
    return setting;
  },

  async delete(salonId: string, id: string): Promise<void> {
    const deleted = await settingsRepository.delete(salonId, id);
    if (!deleted) throw new AppError(404, "Setting not found", "NOT_FOUND");
  },
};
