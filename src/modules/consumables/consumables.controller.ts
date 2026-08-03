import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { consumablesService } from "./consumables.service";
import { ConsumableUsageRequest } from "./consumables.types";

type AuthRequest = Request & { user?: { salonId?: string } };

export const consumablesController = {
  async history(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
      const result = await consumablesService.history(req.user.salonId, {
        page: req.query.page === undefined ? 1 : Number(req.query.page),
        pageSize: req.query.pageSize === undefined ? 20 : Number(req.query.pageSize),
        date_from: req.query.date_from as string | undefined,
        date_to: req.query.date_to as string | undefined,
        product_id: req.query.product_id as string | undefined,
        category_id: req.query.category_id as string | undefined,
        service_id: req.query.service_id as string | undefined,
        staff_id: req.query.staff_id as string | undefined,
        branch_id: req.query.branch_id as string | undefined,
        status: req.query.status as any,
        is_export: req.query.is_export === "true",
      });
      return sendSuccess(res, 200, result, "Consumable usage history fetched successfully");
    } catch (error) { return next(error); }
  },

  async usage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const request = req.body as ConsumableUsageRequest;
      if (!req.user?.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
      if (request.salon_id !== req.user.salonId)
        throw new AppError(403, "salon_id does not match the authenticated salon", "SALON_ACCESS_DENIED");
      const result = await consumablesService.usage(request);
      return sendSuccess(res, 200, result, "Consumable usage fetched successfully");
    } catch (error) { return next(error); }
  },
};
