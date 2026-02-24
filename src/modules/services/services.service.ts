import logger from "../../config/logger";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { servicesRepository } from "./services.repository";
import { CreateCategoryBody, CreateServiceBody, UpdateCategoryBody, UpdateServiceBody } from "./services.types";

async function assertSalonOwnerOrAdmin(params: {
  salonId: string;
  requesterUserId: string;
  requesterRole?: string;
}) {
  if (params.requesterRole === "admin") return;

  const { rows } = await pool.query(`SELECT owner_id FROM salons WHERE id = $1`, [params.salonId]);
  const salon = rows[0];

  if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
  if (salon.owner_id !== params.requesterUserId) throw new AppError(403, "Forbidden", "FORBIDDEN");
}

export const servicesService = {
  // Categories
  async createCategory(salonId: string, requester: { userId: string; role?: string }, body: CreateCategoryBody) {
    logger.info("servicesService.createCategory", { salonId, userId: requester.userId });
    await assertSalonOwnerOrAdmin({ salonId, requesterUserId: requester.userId, requesterRole: requester.role });
    return servicesRepository.createCategory(salonId, body);
  },

  async listCategories(salonId: string) {
    return servicesRepository.listCategories(salonId);
  },

  async updateCategory(categoryId: string, requester: { userId: string; role?: string }, patch: UpdateCategoryBody) {
    const cat = await servicesRepository.findCategoryById(categoryId);
    if (!cat) throw new AppError(404, "Category not found", "NOT_FOUND");

    await assertSalonOwnerOrAdmin({ salonId: cat.salon_id, requesterUserId: requester.userId, requesterRole: requester.role });
    return servicesRepository.updateCategory(categoryId, patch);
  },

  async deleteCategory(categoryId: string, requester: { userId: string; role?: string }) {
    const cat = await servicesRepository.findCategoryById(categoryId);
    if (!cat) throw new AppError(404, "Category not found", "NOT_FOUND");

    await assertSalonOwnerOrAdmin({ salonId: cat.salon_id, requesterUserId: requester.userId, requesterRole: requester.role });
    return servicesRepository.deleteCategory(categoryId);
  },

  // Services
  async createService(salonId: string, requester: { userId: string; role?: string }, body: CreateServiceBody) {
    await assertSalonOwnerOrAdmin({ salonId, requesterUserId: requester.userId, requesterRole: requester.role });

    if (body.category_id) {
      const cat = await servicesRepository.findCategoryById(body.category_id);
      if (!cat || cat.salon_id !== salonId) {
        throw new AppError(400, "Invalid category_id for this salon", "VALIDATION_ERROR");
      }
    }

    return servicesRepository.createService(salonId, body);
  },

  async listServices(salonId: string, categoryId?: string) {
    return servicesRepository.listServices(salonId, categoryId);
  },

  async getServiceById(id: string) {
    const svc = await servicesRepository.findServiceById(id);
    if (!svc) throw new AppError(404, "Service not found", "NOT_FOUND");
    return svc;
  },

  async updateService(serviceId: string, requester: { userId: string; role?: string }, patch: UpdateServiceBody) {
    const svc = await servicesRepository.findServiceById(serviceId);
    if (!svc) throw new AppError(404, "Service not found", "NOT_FOUND");

    await assertSalonOwnerOrAdmin({ salonId: svc.salon_id, requesterUserId: requester.userId, requesterRole: requester.role });

    if (patch.category_id) {
      const cat = await servicesRepository.findCategoryById(patch.category_id);
      if (!cat || cat.salon_id !== svc.salon_id) {
        throw new AppError(400, "Invalid category_id for this salon", "VALIDATION_ERROR");
      }
    }

    return servicesRepository.updateService(serviceId, patch);
  },

  async deleteService(serviceId: string, requester: { userId: string; role?: string }) {
    const svc = await servicesRepository.findServiceById(serviceId);
    if (!svc) throw new AppError(404, "Service not found", "NOT_FOUND");

    await assertSalonOwnerOrAdmin({ salonId: svc.salon_id, requesterUserId: requester.userId, requesterRole: requester.role });
    return servicesRepository.deleteService(serviceId);
  },

  // Staff mapping
  async assignStaffService(staffId: string, serviceId: string, requester: { userId: string; role?: string }) {
    const svc = await servicesRepository.findServiceById(serviceId);
    if (!svc) throw new AppError(404, "Service not found", "NOT_FOUND");

    await assertSalonOwnerOrAdmin({ salonId: svc.salon_id, requesterUserId: requester.userId, requesterRole: requester.role });

    const assigned = await servicesRepository.assignStaffToService(staffId, serviceId);
    if (!assigned) throw new AppError(409, "Staff already assigned to this service", "CONFLICT");

    return assigned;
  },

  async unassignStaffService(staffId: string, serviceId: string, requester: { userId: string; role?: string }) {
    const svc = await servicesRepository.findServiceById(serviceId);
    if (!svc) throw new AppError(404, "Service not found", "NOT_FOUND");

    await assertSalonOwnerOrAdmin({ salonId: svc.salon_id, requesterUserId: requester.userId, requesterRole: requester.role });
    return servicesRepository.unassignStaffFromService(staffId, serviceId);
  },

  async listStaffServices(staffId: string, requester: { userId: string; role?: string }) {
    const isAdmin = requester.role === "admin";
    const isSelf = staffId === requester.userId;

    if (!isAdmin && !isSelf) throw new AppError(403, "Forbidden", "FORBIDDEN");

    return servicesRepository.listStaffServices(staffId);
  },
};
