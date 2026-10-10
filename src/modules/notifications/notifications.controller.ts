import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { notificationsService } from "./notifications.service";
import { deviceTokensService } from "./deviceTokens.service";
import { getSalonId } from "../utils/tenant.util";

import { isMobileStaffRequest } from "./staffNotificationScope";
import { isSessionActiveUncached } from "../auth/session.util";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null; sid?: string } };

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

      // authMiddleware trusts a cached "session active" for a few seconds. A
      // phone kicked by a login elsewhere must not slip its push token back in
      // during that window, or it keeps receiving this account's pushes.
      const sid = req.user?.sid;
      if (sid && !(await isSessionActiveUncached(String(sid)))) {
        throw new AppError(
          401,
          "You were signed out because this account was logged in on another device.",
          "SESSION_REPLACED",
        );
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

      const { token } = req.body ?? {};

      if (typeof token !== "string" || !token.trim()) {
        throw new AppError(400, "token is required", "VALIDATION_ERROR");
      }

      await deviceTokensService.removeToken(token, userId);
      return res.json({ success: true });
    } catch (err) { return next(err); }
  },

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await notificationsService.list(salonId, isMobileStaffRequest(req) ? req.user!.userId : undefined);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const id = String(req.params.id ?? "");
      const data = await notificationsService.markRead(id, salonId, isMobileStaffRequest(req) ? req.user!.userId : undefined);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      await notificationsService.markAllRead(salonId, isMobileStaffRequest(req) ? req.user!.userId : undefined);
      return res.json({ success: true });
    } catch (err) { return next(err); }
  },

  async unreadCount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const count = await notificationsService.getUnreadCount(salonId, isMobileStaffRequest(req) ? req.user!.userId : undefined);
      return res.json({ success: true, data: { count } });
    } catch (err) { return next(err); }
  },
};
