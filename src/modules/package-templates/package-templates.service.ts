import { packageTemplatesRepository } from "./package-templates.repository";
import type {
  PackageTemplate,
  CreatePackageTemplateDTO,
  UpdatePackageTemplateDTO,
} from "./package-templates.types";

export const packageTemplatesService = {

  async list(salonId: string): Promise<PackageTemplate[]> {
    return packageTemplatesRepository.list(salonId);
  },

  async getById(id: string, salonId: string): Promise<PackageTemplate> {
    const t = await packageTemplatesRepository.findById(id, salonId);
    if (!t) throw { statusCode: 404, message: "Package template not found" };
    return t;
  },

  async create(salonId: string, dto: CreatePackageTemplateDTO): Promise<PackageTemplate> {
    return packageTemplatesRepository.create(salonId, dto);
  },

  async update(id: string, salonId: string, dto: UpdatePackageTemplateDTO): Promise<PackageTemplate> {
    const t = await packageTemplatesRepository.update(id, salonId, dto);
    if (!t) throw { statusCode: 404, message: "Package template not found" };
    return t;
  },

  async delete(id: string, salonId: string): Promise<void> {
    const deleted = await packageTemplatesRepository.delete(id, salonId);
    if (!deleted) throw { statusCode: 404, message: "Package template not found" };
  },
};
