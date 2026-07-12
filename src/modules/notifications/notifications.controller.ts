import { Request, Response, NextFunction } from "express";
import { notificationsService } from "./notifications.service";
import { getSalonId } from "../utils/tenant.util";

export const notificationsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await notificationsService.list(salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const { id } = req.params;
      const data = await notificationsService.markRead(id, salonId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      await notificationsService.markAllRead(salonId);
      return res.json({ success: true });
    } catch (err) { return next(err); }
  },

  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const count = await notificationsService.getUnreadCount(salonId);
      return res.json({ success: true, data: { count } });
    } catch (err) { return next(err); }
  },
};
