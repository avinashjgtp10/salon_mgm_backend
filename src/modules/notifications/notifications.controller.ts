import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { notificationsService } from "./notifications.service";
import { deviceTokensService } from "./deviceTokens.service";
import { getSalonId } from "../utils/tenant.util";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const notificationsController = {
  async registerDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      const salonId = await getSalonId(req);
      const {
        token,
        platform,
        installation_id,
        installationId,
        device_installation_id,
        deviceInstallationId,
      } = req.body ?? {};

      if (typeof token !== "string" || !token.trim()) {
        throw new AppError(400, "token is required", "VALIDATION_ERROR");
      }
      if (platform !== "android" && platform !== "ios") {
        throw new AppError(400, "platform must be android or ios", "VALIDATION_ERROR");
      }

      const data = await deviceTokensService.registerExpoPushToken({
        user_id: userId,
        salon_id: salonId,
        expo_push_token: token,
        platform,
        installation_id:
          installation_id ??
          installationId ??
          device_installation_id ??
          deviceInstallationId ??
          null,
      });

      return res.status(201).json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async unregisterDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

      await getSalonId(req);
      const { token } = req.body ?? {};

      if (typeof token !== "string" || !token.trim()) {
        throw new AppError(400, "token is required", "VALIDATION_ERROR");
      }

      await deviceTokensService.removeToken(token);
      return res.json({ success: true });
    } catch (err) { return next(err); }
  },

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await notificationsService.list(salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const id = String(req.params.id ?? "");
      const data = await notificationsService.markRead(id, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      await notificationsService.markAllRead(salonId);
      return res.json({ success: true });
    } catch (err) { return next(err); }
  },

  async unreadCount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const count = await notificationsService.getUnreadCount(salonId);
      return res.json({ success: true, data: { count } });
    } catch (err) { return next(err); }
  },
};
