import { Router } from "express";
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

const viewNotifications = requirePermission("view_notifications");
router.get("/",                  viewNotifications, notificationsController.list);
router.get("/unread-count",      viewNotifications, notificationsController.unreadCount);
router.patch("/read-all",        viewNotifications, notificationsController.markAllRead);
router.patch("/:id/read",        viewNotifications, notificationsController.markRead);

export default router;
