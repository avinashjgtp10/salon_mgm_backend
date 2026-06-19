import { Request, Response, NextFunction } from "express";
import { packageTemplatesService } from "./package-templates.service";
import { sendSuccess } from "../utils/response.util";
import { AppError } from "../../middleware/error.middleware";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const packageTemplatesController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.list(salonId);
      return sendSuccess(res, 200, data, "Package templates fetched");
    } catch (e) { return next(e); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.getById(req.params.id as string, salonId);
      return sendSuccess(res, 200, data, "Package template fetched");
    } catch (e) { return next(e); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.create(salonId, req.body);
      return sendSuccess(res, 201, data, "Package template created");
    } catch (e) { return next(e); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.update(req.params.id as string, salonId, req.body);
      return sendSuccess(res, 200, data, "Package template updated");
    } catch (e) { return next(e); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      await packageTemplatesService.delete(req.params.id as string, salonId);
      return sendSuccess(res, 200, null, "Package template deleted");
    } catch (e) { return next(e); }
  },
};
