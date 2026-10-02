import { isMobileStaffRequest } from "./staffNotificationScope";
import { Router, type Request, type Response, type NextFunction } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { notificationsController } from "./notifications.controller";

const router = Router();

router.use(authMiddleware);

// register-device/unregister-device are push-token infrastructure, not
// "using" the notifications feature — left ungated so push delivery keeps
// working regardless of this permission.
router.post("/register-device",   notificationsController.registerDevice);
router.delete("/register-device", notificationsController.unregisterDevice);

const notificationPermission = requirePermission("view_notifications");
const viewNotifications = (req: Request & { user?: { userId: string; role?: string } }, res: Response, next: NextFunction) =>
  isMobileStaffRequest(req) ? next() : notificationPermission(req, res, next);
router.get("/",                  viewNotifications, notificationsController.list);
router.get("/unread-count",      viewNotifications, notificationsController.unreadCount);
router.patch("/read-all",        viewNotifications, notificationsController.markAllRead);
router.patch("/:id/read",        viewNotifications, notificationsController.markRead);

export default router;
