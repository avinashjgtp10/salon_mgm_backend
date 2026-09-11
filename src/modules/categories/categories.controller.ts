import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";
import { categoriesService } from "./categories.service";
import { CreateCategoryBody, UpdateCategoryBody } from "./categories.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

export const categoriesController = {
  // POST /api/v1/categories
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;

      logger.info("POST /categories called", { salonId });

      if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

      const body = req.body as CreateCategoryBody;

      const created = await categoriesService.create({
        salonId,
        body,
      });

      return sendSuccess(res, 201, created, "Category created successfully");
    } catch (err) {
      logger.error("POST /categories error", { err });
      return next(err);
    }
  },

  // GET /api/v1/categories
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;

      logger.info("GET /categories called", { salonId });

      if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

      const rows = await categoriesService.listMySalonCategories({
        salonId,
      });

      return sendSuccess(res, 200, rows, "Categories fetched successfully");
    } catch (err) {
      logger.error("GET /categories error", { err });
      return next(err);
    }
  },

  // GET /api/v1/categories/:id
  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      const id = String(req.params.id || "").trim();

      logger.info("GET /categories/:id called", { salonId, id });

      if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const cat = await categoriesService.getByIdForMySalon({
        salonId,
        id,
      });

      return sendSuccess(res, 200, cat, "Category fetched successfully");
    } catch (err) {
      logger.error("GET /categories/:id error", { err });
      return next(err);
    }
  },

  // PATCH /api/v1/categories/:id
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      const id = String(req.params.id || "").trim();

      logger.info("PATCH /categories/:id called", { salonId, id });

      if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const patch = req.body as UpdateCategoryBody;

      const updated = await categoriesService.updateForMySalon({
        salonId,
        id,
        patch,
      });

      return sendSuccess(res, 200, updated, "Category updated successfully");
    } catch (err) {
      logger.error("PATCH /categories/:id error", { err });
      return next(err);
    }
  },

  // DELETE /api/v1/categories/:id
  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      const id = String(req.params.id || "").trim();

      logger.info("DELETE /categories/:id called", { salonId, id });

      if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const result = await categoriesService.removeForMySalon({
        salonId,
        id,
      });

      return sendSuccess(res, 200, result, "Category deleted successfully");
    } catch (err) {
      logger.error("DELETE /categories/:id error", { err });
      return next(err);
    }
  },
};
