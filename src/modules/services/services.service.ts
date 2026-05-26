import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { bundlesRepository, servicesRepository } from "./services.repository";
import pool from "../../config/database";
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

  // ─── Import ───────────────────────────────────────────────────────────────────
  async importServices(params: { rows: any[]; salonId: string }) {
    const { rows, salonId } = params;
    const result = { total_rows: rows.length, imported: 0, skipped: 0, errors: [] as string[] };

    // Get existing categories to match by name
    const db = pool;
    const catRows = await db.query(
      "SELECT id, name FROM service_categories WHERE salon_id = $1",
      [salonId]
    );
    const categoryMap: Record<string, string> = {};
    for (const c of catRows.rows ?? []) categoryMap[c.name.toLowerCase()] = c.id;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;
      const name = String(r.Name ?? r.name ?? "").trim();
      if (!name) {
        result.skipped++;
        result.errors.push(`Row ${rowNum}: name is required`);
        continue;
      }

      // Resolve category
      const catName = String(r.Category ?? r.category ?? "").trim();
      let category_id: string | undefined;
      if (catName) {
        if (categoryMap[catName.toLowerCase()]) {
          category_id = categoryMap[catName.toLowerCase()];
        } else {
          // Create category
          try {
            const newCat = await db.query(
              "INSERT INTO service_categories (salon_id, name) VALUES ($1, $2) RETURNING id",
              [salonId, catName]
            );
            category_id = newCat.rows[0].id;
            categoryMap[catName.toLowerCase()] = category_id!;
          } catch {
            result.skipped++;
            result.errors.push(`Row ${rowNum}: failed to create category "${catName}"`);
            continue;
          }
        }
      }

      const priceRaw = String(r["Price / Retail Price"] ?? r.Price ?? r.price ?? "0").replace(/[^0-9.]/g, "");
      const durationRaw = String(r["Duration (min)"] ?? r.Duration ?? r.duration ?? "30").replace(/[^0-9]/g, "");
      const priceTypeRaw = String(r["Price Type"] ?? r.price_type ?? "fixed").toLowerCase().trim();
      const priceType = (["fixed", "from", "free"].includes(priceTypeRaw) ? priceTypeRaw : "fixed") as "fixed" | "from" | "free";
      const onlineBooking = ["yes", "true", "1"].includes(String(r["Online Booking"] ?? r.online_booking ?? "yes").toLowerCase());

      const body: CreateServiceBody = {
        name,
        category_id: category_id!,
        description: String(r.Description ?? r.description ?? "").trim() || undefined,
        price_type: priceType,
        price: parseFloat(priceRaw) || 0,
        duration: parseInt(durationRaw) || 30,
        online_booking: onlineBooking,
        commission_enabled: ["yes", "true", "1"].includes(String(r.Commission ?? r.commission_enabled ?? "no").toLowerCase()),
        resource_required: ["yes", "true", "1"].includes(String(r["Resource Required"] ?? r.resource_required ?? "no").toLowerCase()),
      };

      try {
        await servicesRepository.create(body, salonId);
        result.imported++;
      } catch (err: any) {
        result.skipped++;
        result.errors.push(`Row ${rowNum}: ${err?.message ?? "Failed to create service"}`);
      }
    }

    return result;
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