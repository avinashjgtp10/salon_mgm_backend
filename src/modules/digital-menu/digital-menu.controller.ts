import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { digitalMenuService } from "./digital-menu.service";
import { SaveDigitalMenuBody } from "./digital-menu.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const digitalMenuController = {
  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const menu = await digitalMenuService.get(salonId);
      return sendSuccess(res, 200, menu, "Digital menu fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const created = await digitalMenuService.create(salonId, req.body as SaveDigitalMenuBody);
      return sendSuccess(res, 201, created, "Digital menu created successfully");
    } catch (err) {
      return next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || "").trim();
      if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const updated = await digitalMenuService.update(salonId, id, req.body as SaveDigitalMenuBody);
      return sendSuccess(res, 200, updated, "Digital menu updated successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const token = String(req.params.token || "").trim();
      if (!token) throw new AppError(400, "token is required", "VALIDATION_ERROR");
      const menu = await digitalMenuService.getPublicByToken(token);
      return sendSuccess(res, 200, menu, "Menu fetched successfully");
    } catch (err) {
      return next(err);
    }
  },
};
