import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { notificationsController } from "./notifications.controller";

const router = Router();

router.use(authMiddleware);

router.get("/",                  notificationsController.list);
router.get("/unread-count",      notificationsController.unreadCount);
router.patch("/read-all",        notificationsController.markAllRead);
router.patch("/:id/read",        notificationsController.markRead);

export default router;
