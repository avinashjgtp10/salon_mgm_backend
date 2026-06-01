import { clientPackagesRepository } from "./client-packages.repository";
import type {
  ClientPackage,
  CreateClientPackageDTO,
  CompleteSessionDTO,
  ClientPackagesListQuery,
} from "./client-packages.types";

export const clientPackagesService = {

  async list(
    salonId: string,
    query: ClientPackagesListQuery,
  ): Promise<{ items: ClientPackage[]; total: number }> {
    return clientPackagesRepository.list(salonId, query);
  },

  async getById(id: string, salonId: string): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.findById(id, salonId);
    if (!pkg) throw { statusCode: 404, message: "Client package not found" };
    return pkg;
  },

  async create(salonId: string, dto: CreateClientPackageDTO): Promise<ClientPackage> {
    return clientPackagesRepository.create(salonId, dto);
  },

  async completeSession(
    packageId: string,
    salonId:   string,
    dto:       CompleteSessionDTO,
  ): Promise<ClientPackage> {
    const updated = await clientPackagesRepository.completeSession(packageId, salonId, dto);
    if (!updated) throw { statusCode: 404, message: "Client package not found" };
    return updated;
  },
};
