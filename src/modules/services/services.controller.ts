import { NextFunction, Request, Response } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { bundlesService, servicesService } from "./services.service";

import {
  CreateAddOnGroupBody,
  CreateAddOnOptionBody,
  CreateBundleBody,
  CreateServiceBody,
  ListBundlesQuery,
  ListServicesQuery,
  UpdateAddOnGroupBody,
  UpdateAddOnOptionBody,
  UpdateBundleBody,
  UpdateServiceBody,
} from "./services.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string };
};

// ─── Services ─────────────────────────────────────────────────────────────────

export const servicesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as any;
      const query: ListServicesQuery = {
        category_id: q.category_id,
        search: q.search,
        status: q.status,
        type: q.type,
        staff_id: q.staff_id,
        online_booking: q.online_booking,
        commissions: q.commissions,
        resource_requirements: q.resource_requirements,
        page: q.page ? Number(q.page) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      };
      logger.info("GET /services", { query });
      const result = await servicesService.list(query);
      return sendSuccess(res, 200, result, "Services list fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      logger.info("POST /services", { userId });
      const created = await servicesService.create({
        requesterUserId: userId,
        requesterRole: req.user?.role,
        body: req.body as CreateServiceBody,
      });
      return sendSuccess(res, 201, created, "Service created successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const service = await servicesService.getById(id);
      return sendSuccess(res, 200, service, "Service fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const updated = await servicesService.update({
        serviceId: id,
        requesterUserId: userId,
        requesterRole: req.user?.role,
        patch: req.body as UpdateServiceBody,
      });
      return sendSuccess(res, 200, updated, "Service updated successfully");
    } catch (err) {
      return next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      await servicesService.remove(id);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },

  async listAddOnGroups(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const groups = await servicesService.listAddOnGroups(id);
      return sendSuccess(res, 200, groups, "Add-on groups fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async createAddOnGroup(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const created = await servicesService.createAddOnGroup({
        serviceId: id,
        requesterUserId: userId,
        requesterRole: req.user?.role,
        body: req.body as CreateAddOnGroupBody,
      });
      return sendSuccess(res, 201, created, "Add-on group created successfully");
    } catch (err) {
      return next(err);
    }
  },

  async updateAddOnGroup(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      const groupId = String(req.params.groupId || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      if (!groupId) throw new AppError(400, "groupId is required", "VALIDATION_ERROR");
      const updated = await servicesService.updateAddOnGroup({
        serviceId: id,
        groupId,
        requesterUserId: userId,
        requesterRole: req.user?.role,
        patch: req.body as UpdateAddOnGroupBody,
      });
      return sendSuccess(res, 200, updated, "Add-on group updated successfully");
    } catch (err) {
      return next(err);
    }
  },

  async deleteAddOnGroup(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      const groupId = String(req.params.groupId || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      if (!groupId) throw new AppError(400, "groupId is required", "VALIDATION_ERROR");
      await servicesService.deleteAddOnGroup({ serviceId: id, groupId });
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },

  async createAddOnOption(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      const groupId = String(req.params.groupId || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      if (!groupId) throw new AppError(400, "groupId is required", "VALIDATION_ERROR");
      const created = await servicesService.createAddOnOption({
        serviceId: id,
        groupId,
        requesterUserId: userId,
        requesterRole: req.user?.role,
        body: req.body as CreateAddOnOptionBody,
      });
      return sendSuccess(res, 201, created, "Add-on option created successfully");
    } catch (err) {
      return next(err);
    }
  },

  async updateAddOnOption(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      const groupId = String(req.params.groupId || "").trim();
      const optionId = String(req.params.optionId || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      if (!groupId) throw new AppError(400, "groupId is required", "VALIDATION_ERROR");
      if (!optionId) throw new AppError(400, "optionId is required", "VALIDATION_ERROR");
      const updated = await servicesService.updateAddOnOption({
        serviceId: id,
        groupId,
        optionId,
        requesterUserId: userId,
        requesterRole: req.user?.role,
        patch: req.body as UpdateAddOnOptionBody,
      });
      return sendSuccess(res, 200, updated, "Add-on option updated successfully");
    } catch (err) {
      return next(err);
    }
  },

  async deleteAddOnOption(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      const groupId = String(req.params.groupId || "").trim();
      const optionId = String(req.params.optionId || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      if (!groupId) throw new AppError(400, "groupId is required", "VALIDATION_ERROR");
      if (!optionId) throw new AppError(400, "optionId is required", "VALIDATION_ERROR");
      await servicesService.deleteAddOnOption({ serviceId: id, groupId, optionId });
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
};

// ─── Bundles ──────────────────────────────────────────────────────────────────

export const bundlesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as any;
      const query: ListBundlesQuery = {
        category_id: q.category_id,
        search: q.search,
        status: q.status,
        team_member_id: q.team_member_id,
        online_booking: q.online_booking,
        commissions: q.commissions,
        resource_requirements: q.resource_requirements,
        available_for: q.available_for,
        page: q.page ? Number(q.page) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      };
      logger.info("GET /bundles", { query });
      const result = await bundlesService.list(query);
      return sendSuccess(res, 200, result, "Bundles list fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      logger.info("POST /bundles", { userId });
      const created = await bundlesService.create({
        requesterUserId: userId,
        requesterRole: req.user?.role,
        body: req.body as CreateBundleBody,
      });
      return sendSuccess(res, 201, created, "Bundle created successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const bundle = await bundlesService.getById(id);
      return sendSuccess(res, 200, bundle, "Bundle fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const updated = await bundlesService.update({
        bundleId: id,
        requesterUserId: userId,
        requesterRole: req.user?.role,
        patch: req.body as UpdateBundleBody,
      });
      return sendSuccess(res, 200, updated, "Bundle updated successfully");
    } catch (err) {
      return next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id = String(req.params.id || "").trim();
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      await bundlesService.remove(id);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
};