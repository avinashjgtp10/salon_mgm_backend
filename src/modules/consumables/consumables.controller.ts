import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { consumablesService } from "./consumables.service";
import { ConsumableUsageRequest } from "./consumables.types";

type AuthRequest = Request & { user?: { salonId?: string } };

export const consumablesController = {
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
