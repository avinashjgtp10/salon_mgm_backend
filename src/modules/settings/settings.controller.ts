import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { invalidatePermissionCache } from "../../middleware/permission.middleware";
import { sendSuccess } from "../utils/response.util";
import { settingsService } from "./settings.service";
import { CreateSettingBody, UpdateSettingBody } from "./settings.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

export const settingsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const data = await settingsService.list(salonId);
      sendSuccess(res, 200, data, "Settings fetched");
    } catch (err) { next(err); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const data = await settingsService.getById(salonId, String(req.params.id));
      sendSuccess(res, 200, data, "Setting fetched");
    } catch (err) { next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const body = req.body as CreateSettingBody;
      if (!body.key) throw new AppError(400, "key is required", "VALIDATION_ERROR");
      if (body.value === undefined) throw new AppError(400, "value is required", "VALIDATION_ERROR");
      const data = await settingsService.create(salonId, body);
      if (body.key === "role_permissions") invalidatePermissionCache(salonId);
      sendSuccess(res, 201, data, "Setting created");
    } catch (err) { next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      const data = await settingsService.update(salonId, String(req.params.id), req.body as UpdateSettingBody);
      invalidatePermissionCache(salonId);
      sendSuccess(res, 200, data, "Setting updated");
    } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(400, "Salon context missing", "NO_SALON");
      await settingsService.delete(salonId, String(req.params.id));
      sendSuccess(res, 200, null, "Setting deleted");
    } catch (err) { next(err); }
  },
};
