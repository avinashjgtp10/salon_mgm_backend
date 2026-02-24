import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";
import { categoriesService } from "./categories.service";
import { CreateCategoryBody, UpdateCategoryBody } from "./categories.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string };
};

export const categoriesController = {
  // POST /api/v1/categories
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;

      logger.info("POST /categories called", { userId });

      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const body = req.body as CreateCategoryBody;

      const created = await categoriesService.create({
        requesterUserId: userId,
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
      const userId = req.user?.userId;

      logger.info("GET /categories called", { userId });

      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const rows = await categoriesService.listMySalonCategories({
        requesterUserId: userId,
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
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();

      logger.info("GET /categories/:id called", { userId, id });

      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const cat = await categoriesService.getByIdForMySalon({
        requesterUserId: userId,
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
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();

      logger.info("PATCH /categories/:id called", { userId, id });

      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const patch = req.body as UpdateCategoryBody;

      const updated = await categoriesService.updateForMySalon({
        requesterUserId: userId,
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
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();

      logger.info("DELETE /categories/:id called", { userId, id });

      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

      const result = await categoriesService.removeForMySalon({
        requesterUserId: userId,
        id,
      });

      return sendSuccess(res, 200, result, "Category deleted successfully");
    } catch (err) {
      logger.error("DELETE /categories/:id error", { err });
      return next(err);
    }
  },
};