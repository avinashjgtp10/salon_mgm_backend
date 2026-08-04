import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { clientCommunicationService } from "./client-communication.service";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};

export const clientCommunicationController = {
  // GET /api/v1/clients/:clientId/communications
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const clientId = String(req.params.clientId || "").trim();
      const data = await clientCommunicationService.list(clientId, getSalonId(req));
      return sendSuccess(res, 200, data, "Client communication history fetched successfully");
    } catch (err) { return next(err); }
  },
};
