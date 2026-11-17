import { NextFunction, Request, Response } from "express";
import { clientPackagesService } from "./client-packages.service";
import { redemptionOtpService } from "../redemption-otp/redemption-otp.service";
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

export const clientPackagesController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientPackagesService.list(salonId, req.query as any);
      return sendSuccess(res, 200, data, "Client packages fetched successfully");
    } catch (e) { return next(e); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientPackagesService.getById(req.params.id as string, salonId);
      return sendSuccess(res, 200, data, "Client package fetched successfully");
    } catch (e) { return next(e); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientPackagesService.create(salonId, req.body, req.user?.userId);
      return sendSuccess(res, 201, data, "Client package created successfully");
    } catch (e) { return next(e); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await clientPackagesService.update(req.params.id as string, salonId, req.body);
      return sendSuccess(res, 200, data, "Client package updated successfully");
    } catch (e) { return next(e); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      await clientPackagesService.delete(req.params.id as string, salonId);
      return sendSuccess(res, 200, null, "Client package deleted successfully");
    } catch (e) { return next(e); }
  },

  async completeSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      // Client WhatsApp OTP gate (Settings > Extras, default OFF). Here at the
      // route, not in the service: the service is also called by the no-show
      // scheduler and the scheduled-appointment auto-redeem, where the client is
      // not present to receive a code.
      if (await redemptionOtpService.isRequired(salonId, ["package"])) {
        const pkg = await clientPackagesService.getById(req.params.id as string, salonId);
        await redemptionOtpService.assertVerified(salonId, pkg.clientId, ["package"]);
      }
      const data = await clientPackagesService.completeSession(
        req.params.id as string,
        salonId,
        req.body,
      );
      return sendSuccess(res, 200, data, "Session marked as completed");
    } catch (e) { return next(e); }
  },
};
