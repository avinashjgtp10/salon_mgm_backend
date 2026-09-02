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
  CreateConsultationFormBody,
  CreateServiceBody,
  ListBundlesQuery,
  ListServicesQuery,
  Service,
  ServiceDetail,
  ServiceListResponse,
  UpdateAddOnGroupBody,
  UpdateAddOnOptionBody,
  UpdateBundleBody,
  UpdateConsultationFormBody,
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

    const duplicate = await servicesRepository.findDuplicate(
      body.name,
      body.duration ?? 30,
      body.price ?? 0,
      salonId
    );
    if (duplicate) {
      throw new AppError(400, "A service with the same name, duration, and price already exists.", "DUPLICATE_SERVICE");
    }

    const created = await servicesRepository.create(body, salonId);
    if (body.staff_ids?.length) {
      await servicesRepository.replaceStaff(created.id, body.staff_ids);
    }
    if (body.consumables_used?.length) {
      await servicesRepository.replaceConsumables(created.id, body.consumables_used);
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

    const nameToCheck = patch.name !== undefined ? patch.name : existing.name;
    const durationToCheck = patch.duration !== undefined ? patch.duration : existing.duration;
    const priceToCheck = patch.price !== undefined ? Number(patch.price) : Number(existing.price);

    const duplicate = await servicesRepository.findDuplicate(
      nameToCheck,
      durationToCheck,
      priceToCheck,
      salonId,
      serviceId
    );
    if (duplicate) {
      throw new AppError(400, "A service with the same name, duration, and price already exists.", "DUPLICATE_SERVICE");
    }

    const staffIds =
      patch.staff_ids ??
      ((patch as Record<string, unknown>).team_member_ids as string[] | undefined);
    const updated = await servicesRepository.update(serviceId, patch, salonId);
    if (staffIds !== undefined) {
      await servicesRepository.replaceStaff(serviceId, staffIds);
    }
    if (patch.consumables_used !== undefined) {
      await servicesRepository.replaceConsumables(serviceId, patch.consumables_used);
    }
    logger.info("servicesService.update success", { serviceId });
    return updated;
  },

  async remove(serviceId: string, salonId: string): Promise<void> {
    const existing = await servicesRepository.findById(serviceId, salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    await servicesRepository.delete(serviceId, salonId);
  },

  async listConsultationForms(serviceId: string, salonId: string) {
    const existing = await servicesRepository.findById(serviceId, salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    return servicesRepository.listConsultationForms(serviceId);
  },

  async createConsultationForm(params: {
    serviceId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    body: CreateConsultationFormBody;
  }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    return servicesRepository.createConsultationForm(params.serviceId, params.body);
  },

  async updateConsultationForm(params: {
    serviceId: string;
    formId: string;
    requesterUserId: string;
    requesterRole?: string;
    salonId: string;
    patch: UpdateConsultationFormBody;
  }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const forms = await servicesRepository.listConsultationForms(params.serviceId);
    if (!forms.some((f) => f.id === params.formId))
      throw new AppError(404, "Consultation form not found for this service", "NOT_FOUND");
    return servicesRepository.updateConsultationForm(params.formId, params.patch);
  },

  async deleteConsultationForm(params: { serviceId: string; formId: string; salonId: string }) {
    const existing = await servicesRepository.findById(params.serviceId, params.salonId);
    if (!existing) throw new AppError(404, "Service not found", "NOT_FOUND");
    const forms = await servicesRepository.listConsultationForms(params.serviceId);
    if (!forms.some((f) => f.id === params.formId))
      throw new AppError(404, "Consultation form not found for this service", "NOT_FOUND");
    await servicesRepository.deleteConsultationForm(params.formId);
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
    type ImportRowIssue = string | { row: number; name: string; status: "skipped" | "failed"; reason: string };
    const result = { total_rows: rows.length, imported: 0, skipped: 0, errors: [] as ImportRowIssue[] };

    // ── Column validation ─────────────────────────────────────────────────────
    // Checked against the header row before touching any data row — a file
    // with the wrong columns entirely shouldn't produce a pile of per-row
    // "missing X" errors, it should fail fast with one clear reason.
    const REQUIRED_COLUMNS = ["Name", "Category", "Description", "Price / Retail Price", "Duration (min)"];
    // Extra columns the importer already knows how to use beyond the
    // required template — allowed without tripping an "unexpected column" error.
    const OPTIONAL_KNOWN_COLUMNS = ["Price Type", "Online Booking", "Commission", "Resource Required"];
    const ALLOWED_COLUMNS = new Set([...REQUIRED_COLUMNS, ...OPTIONAL_KNOWN_COLUMNS]);
    // Common near-miss headers → the exact column name they were probably
    // meant to be, so a rename typo gets a precise fix instead of a vague
    // "extra column" complaint.
    const COLUMN_ALIASES: Record<string, string> = {
      "service name": "Name",
      "retail price": "Price / Retail Price",
      "price": "Price / Retail Price",
      "duration": "Duration (min)",
      "service category": "Category",
      "service description": "Description",
    };

    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      const headerSet = new Set(headers);
      const missingColumns = REQUIRED_COLUMNS.filter((c) => !headerSet.has(c));

      const misnamedColumn = headers.find((h) => {
        if (ALLOWED_COLUMNS.has(h)) return false;
        const canonical = COLUMN_ALIASES[h.trim().toLowerCase()];
        return canonical && missingColumns.includes(canonical);
      });
      if (misnamedColumn) {
        const canonical = COLUMN_ALIASES[misnamedColumn.trim().toLowerCase()];
        throw new AppError(
          400,
          `Invalid column found: "${misnamedColumn}". Expected column: "${canonical}".`,
          "INVALID_IMPORT_COLUMNS"
        );
      }

      if (missingColumns.length > 0) {
        throw new AppError(
          400,
          `Invalid import file format. The following required columns are missing: ${missingColumns.join(", ")}`,
          "INVALID_IMPORT_COLUMNS"
        );
      }

      const unexpectedColumns = headers.filter((h) => !ALLOWED_COLUMNS.has(h));
      if (unexpectedColumns.length > 0) {
        throw new AppError(
          400,
          `Invalid import file format. Unexpected column(s) found: ${unexpectedColumns.join(", ")}`,
          "INVALID_IMPORT_COLUMNS"
        );
      }
    }

    // Get existing categories to match by name — scoped to categories usable
    // for services (type 'service' or 'both'), so a product-only category
    // sharing the same name is never silently reused here.
    const db = pool;
    const catRows = await db.query(
      "SELECT id, name FROM service_categories WHERE salon_id = $1 AND type IN ('service', 'both')",
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
              "INSERT INTO service_categories (salon_id, name, type) VALUES ($1, $2, 'service') RETURNING id",
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

      // Re-importing the same file (or a file with rows that already exist)
      // must not create a duplicate row — match on the same fields the
      // single-service create/update endpoints already dedupe on (Name +
      // Duration + Price), plus Category, since an import row additionally
      // carries a category and two same-priced services in different
      // categories are legitimately different offerings.
      const duplicate = await servicesRepository.findDuplicate(name, body.duration ?? 30, body.price ?? 0, salonId);
      if (duplicate && ((duplicate as any).category_id ?? null) === (category_id ?? null)) {
        result.skipped++;
        result.errors.push({ row: rowNum, name, status: "skipped", reason: "Duplicate Service Name" });
        continue;
      }

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