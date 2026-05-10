import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { bundlesRepository, servicesRepository } from "./services.repository";
import {
  BundleDetail,
  BundleListResponse,
  CreateAddOnGroupBody,
  CreateAddOnOptionBody,
  CreateBundleBody,
  CreateServiceBody,
  ListBundlesQuery,
  ListServicesQuery,
  Service,
  ServiceDetail,
  ServiceListResponse,
  UpdateAddOnGroupBody,
  UpdateAddOnOptionBody,
  UpdateBundleBody,
  UpdateServiceBody,
} from "./services.types";

export const servicesService = {
  async list(query: ListServicesQuery, salonId: string): Promise<ServiceListResponse> {
    return servicesRepository.list(query, salonId);
  },

  async create(params: {
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    body: CreateServiceBody;
  }): Promise<Service> {
    const { requesterUserId, requesterRole, salonId, body } = params;
    logger.info("servicesService.create", { requesterUserId, requesterRole, salonId });
    const created = await servicesRepository.create(body, salonId);
    if (body.staff_ids?.length) {
      await servicesRepository.replaceStaff(created.id, body.staff_ids);
    }
    logger.info("servicesService.create success", { serviceId: created.id });
    return created;
  },

  async getById(serviceId: string, salonId: string): Promise<ServiceDetail> {
    const detail = await servicesRepository.getDetailById(serviceId, salonId);
    if (!detail) throw new AppError(404, "Service not found", "NOT_FOUND");
    return detail;
  },

  async update(params: {
    serviceId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    patch: UpdateServiceBody;
  }): Promise<Service> {
    const { serviceId, requesterUserId, requesterRole, salonId, patch } = params;
    logger.info("servicesService.update", { serviceId, requesterUserId, requesterRole });
    const existing = await servicesRepository.findById(serviceId, salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const staffIds =
      patch.staff_ids ??
      ((patch as Record<string, unknown>).team_member_ids as string[] | undefined);
    const updated = await servicesRepository.update(serviceId, patch, salonId);
    if (staffIds !== undefined) {
      await servicesRepository.replaceStaff(serviceId, staffIds);
    }
    logger.info("servicesService.update success", { serviceId });
    return updated;
  },

  async remove(serviceId: string, salonId: string): Promise<void> {
    const existing = await servicesRepository.findById(serviceId, salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    await servicesRepository.delete(serviceId, salonId);
  },

  async listAddOnGroups(serviceId: string, salonId: string) {
    const existing = await servicesRepository.findById(serviceId, salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    return servicesRepository.listAddOnGroupsWithOptions(serviceId);
  },

  async createAddOnGroup(params: {
    serviceId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    body: CreateAddOnGroupBody;
  }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    return servicesRepository.createAddOnGroup(params.serviceId, params.body);
  },

  async updateAddOnGroup(params: {
    serviceId: string;
    groupId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    patch: UpdateAddOnGroupBody;
  }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const groups = await servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
    if (!groups.some((g) => g.id === params.groupId))
      throw new AppError(404, "Add-on group not found for this service", "NOT_FOUND");
    return servicesRepository.updateAddOnGroup(params.groupId, params.patch);
  },

  async deleteAddOnGroup(params: { serviceId: string; groupId: string; salonId: string }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const groups = await servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
    if (!groups.some((g) => g.id === params.groupId))
      throw new AppError(404, "Add-on group not found for this service", "NOT_FOUND");
    await servicesRepository.deleteAddOnGroup(params.groupId);
  },

  async createAddOnOption(params: {
    serviceId: string;
    groupId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    body: CreateAddOnOptionBody;
  }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const groups = await servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
    if (!groups.some((g) => g.id === params.groupId))
      throw new AppError(404, "Add-on group not found for this service", "NOT_FOUND");
    return servicesRepository.createAddOnOption(params.groupId, params.body);
  },

  async updateAddOnOption(params: {
    serviceId: string;
    groupId: string;
    optionId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    patch: UpdateAddOnOptionBody;
  }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const groups = await servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
    const group = groups.find((g) => g.id === params.groupId);
    if (!group) throw new AppError(404, "Add-on group not found for this service", "NOT_FOUND");
    if (!group.options.some((o) => o.id === params.optionId))
      throw new AppError(404, "Add-on option not found for this group", "NOT_FOUND");
    return servicesRepository.updateAddOnOption(params.optionId, params.patch);
  },

  async deleteAddOnOption(params: { serviceId: string; groupId: string; optionId: string; salonId: string }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const groups = await servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
    const group = groups.find((g) => g.id === params.groupId);
    if (!group) throw new AppError(404, "Add-on group not found for this service", "NOT_FOUND");
    if (!group.options.some((o) => o.id === params.optionId))
      throw new AppError(404, "Add-on option not found for this group", "NOT_FOUND");
    await servicesRepository.deleteAddOnOption(params.optionId);
  },
};

export const bundlesService = {
  async list(query: ListBundlesQuery, salonId: string): Promise<BundleListResponse> {
    return bundlesRepository.list(query, salonId);
  },

  async create(params: {
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    body: CreateBundleBody;
  }): Promise<BundleDetail> {
    const { requesterUserId, requesterRole, salonId, body } = params;
    logger.info("bundlesService.create", { requesterUserId, requesterRole, salonId });
    const created = await bundlesRepository.create(body, salonId);
    if (body.service_ids?.length) {
      await bundlesRepository.replaceServices(created.id, body.service_ids);
    }
    logger.info("bundlesService.create success", { bundleId: created.id });
    return bundlesRepository.getDetailById(created.id, salonId) as Promise<BundleDetail>;
  },

  async getById(bundleId: string, salonId: string): Promise<BundleDetail> {
    const detail = await bundlesRepository.getDetailById(bundleId, salonId);
    if (!detail) throw new AppError(404, "Bundle not found", "NOT_FOUND");
    return detail;
  },

  async update(params: {
    bundleId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    patch: UpdateBundleBody;
  }): Promise<BundleDetail> {
    const { bundleId, requesterUserId, requesterRole, salonId, patch } = params;
    logger.info("bundlesService.update", { bundleId, requesterUserId, requesterRole });
    const existing = await bundlesRepository.findById(bundleId, salonId);
    if (!existing) throw new AppError(404, "Bundle not found", "NOT_FOUND");
    await bundlesRepository.update(bundleId, patch, salonId);
    if (patch.service_ids !== undefined) {
      await bundlesRepository.replaceServices(bundleId, patch.service_ids);
    }
    logger.info("bundlesService.update success", { bundleId });
    return bundlesRepository.getDetailById(bundleId, salonId) as Promise<BundleDetail>;
  },

  async remove(bundleId: string, salonId: string): Promise<void> {
    const existing = await bundlesRepository.findById(bundleId, salonId);
    if (!existing) throw new AppError(404, "Bundle not found", "NOT_FOUND");
    await bundlesRepository.delete(bundleId, salonId);
  },
};