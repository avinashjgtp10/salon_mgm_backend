import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { staffAvailabilityService } from "./staffAvailability.service";

type AuthRequest = Request & { user?: { salonId?: string } };

export const staffAvailabilityController = {
  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
      const data = await staffAvailabilityService.getAvailability({
        staffId: String(req.params.staffId),
        salonId,
        date: String(req.query.date),
        serviceId: req.query.serviceId ? String(req.query.serviceId) : undefined,
        branchId: req.query.branchId ? String(req.query.branchId) : undefined,
      });
      return sendSuccess(res, 200, data, "Staff availability fetched successfully");
    } catch (err) { return next(err); }
  },
};
