import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { servicesService } from "./services.service";
import {
  CreateCategoryBody,
  CreateServiceBody,
  UpdateCategoryBody,
  UpdateServiceBody,
} from "./services.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string };
};

const asId = (v: unknown) => String(v || "").trim();

export const servicesController = {
  // ===================== CATEGORIES =====================

  // POST /api/v1/salons/:salonId/categories
  async createCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const salonId = asId(req.params.salonId);
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");

      logger.info("POST categories", {
        salonId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const body = req.body as CreateCategoryBody;

      const data = await servicesService.createCategory(
        salonId,
        { userId: req.user.userId, role: req.user.role },
        body
      );

      return sendSuccess(res, 201, data, "Category created successfully");
    } catch (e) {
      logger.error("POST categories error", { e });
      return next(e);
    }
  },

  // GET /api/v1/salons/:salonId/categories
  async listCategories(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = asId(req.params.salonId);
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");

      logger.info("GET categories", { salonId, path: req.originalUrl });

      const data = await servicesService.listCategories(salonId);
      return sendSuccess(res, 200, data, "Categories fetched successfully");
    } catch (e) {
      logger.error("GET categories error", { e });
      return next(e);
    }
  },

  // PATCH /api/v1/categories/:id
  async updateCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const categoryId = asId(req.params.id);
      if (!categoryId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      logger.info("PATCH category", {
        categoryId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const patch = req.body as UpdateCategoryBody;

      const data = await servicesService.updateCategory(
        categoryId,
        { userId: req.user.userId, role: req.user.role },
        patch
      );

      return sendSuccess(res, 200, data, "Category updated successfully");
    } catch (e) {
      logger.error("PATCH category error", { e });
      return next(e);
    }
  },

  // DELETE /api/v1/categories/:id
  async deleteCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const categoryId = asId(req.params.id);
      if (!categoryId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      logger.info("DELETE category", {
        categoryId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const data = await servicesService.deleteCategory(categoryId, {
        userId: req.user.userId,
        role: req.user.role,
      });

      return sendSuccess(res, 200, data, "Category deleted successfully");
    } catch (e) {
      logger.error("DELETE category error", { e });
      return next(e);
    }
  },

  // ===================== SERVICES =====================

  // POST /api/v1/salons/:salonId/services
  async createService(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const salonId = asId(req.params.salonId);
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");

      logger.info("POST service", {
        salonId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const body = req.body as CreateServiceBody;

      const data = await servicesService.createService(
        salonId,
        { userId: req.user.userId, role: req.user.role },
        body
      );

      return sendSuccess(res, 201, data, "Service created successfully");
    } catch (e) {
      logger.error("POST service error", { e });
      return next(e);
    }
  },

  // GET /api/v1/salons/:salonId/services?categoryId=
  async listServices(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = asId(req.params.salonId);
      if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR");

      const categoryId = req.query.categoryId ? asId(req.query.categoryId) : undefined;

      logger.info("GET services", { salonId, categoryId, path: req.originalUrl });

      const data = await servicesService.listServices(salonId, categoryId);
      return sendSuccess(res, 200, data, "Services fetched successfully");
    } catch (e) {
      logger.error("GET services error", { e });
      return next(e);
    }
  },

  // GET /api/v1/services/:id
  async getServiceById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const serviceId = asId(req.params.id);
      if (!serviceId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      logger.info("GET service by id", { serviceId, path: req.originalUrl });

      const data = await servicesService.getServiceById(serviceId);
      return sendSuccess(res, 200, data, "Service fetched successfully");
    } catch (e) {
      logger.error("GET service by id error", { e });
      return next(e);
    }
  },

  // PATCH /api/v1/services/:id
  async updateService(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const serviceId = asId(req.params.id);
      if (!serviceId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      logger.info("PATCH service", {
        serviceId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const patch = req.body as UpdateServiceBody;

      const data = await servicesService.updateService(
        serviceId,
        { userId: req.user.userId, role: req.user.role },
        patch
      );

      return sendSuccess(res, 200, data, "Service updated successfully");
    } catch (e) {
      logger.error("PATCH service error", { e });
      return next(e);
    }
  },

  // DELETE /api/v1/services/:id
  async deleteService(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const serviceId = asId(req.params.id);
      if (!serviceId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      logger.info("DELETE service", {
        serviceId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const data = await servicesService.deleteService(serviceId, {
        userId: req.user.userId,
        role: req.user.role,
      });

      return sendSuccess(res, 200, data, "Service deleted successfully");
    } catch (e) {
      logger.error("DELETE service error", { e });
      return next(e);
    }
  },

  // ===================== STAFF ↔ SERVICES =====================

  // POST /api/v1/staff/:staffId/services/:serviceId
  async assignStaffService(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const staffId = asId(req.params.staffId);
      const serviceId = asId(req.params.serviceId);
      if (!staffId || !serviceId) {
        throw new AppError(400, "staffId and serviceId are required", "VALIDATION_ERROR");
      }

      logger.info("Assign staff->service", {
        staffId,
        serviceId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const data = await servicesService.assignStaffService(staffId, serviceId, {
        userId: req.user.userId,
        role: req.user.role,
      });

      return sendSuccess(res, 201, data, "Staff assigned to service");
    } catch (e) {
      logger.error("Assign staff->service error", { e });
      return next(e);
    }
  },

  // DELETE /api/v1/staff/:staffId/services/:serviceId
  async unassignStaffService(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const staffId = asId(req.params.staffId);
      const serviceId = asId(req.params.serviceId);
      if (!staffId || !serviceId) {
        throw new AppError(400, "staffId and serviceId are required", "VALIDATION_ERROR");
      }

      logger.info("Unassign staff->service", {
        staffId,
        serviceId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const data = await servicesService.unassignStaffService(staffId, serviceId, {
        userId: req.user.userId,
        role: req.user.role,
      });

      return sendSuccess(res, 200, data, "Staff unassigned from service");
    } catch (e) {
      logger.error("Unassign staff->service error", { e });
      return next(e);
    }
  },

  // GET /api/v1/staff/:staffId/services
  async listStaffServices(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const staffId = asId(req.params.staffId);
      if (!staffId) throw new AppError(400, "staffId is required", "VALIDATION_ERROR");

      logger.info("List staff services", {
        staffId,
        userId: req.user.userId,
        role: req.user.role,
        path: req.originalUrl,
      });

      const data = await servicesService.listStaffServices(staffId, {
        userId: req.user.userId,
        role: req.user.role,
      });

      return sendSuccess(res, 200, data, "Staff services fetched successfully");
    } catch (e) {
      logger.error("List staff services error", { e });
      return next(e);
    }
  },
};
