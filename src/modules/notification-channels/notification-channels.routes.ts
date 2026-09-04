// ============================================================
// SalonOx — Notification Channel Templates: Routes
// ============================================================

import { Router } from "express"
import { authMiddleware } from "../../middleware/auth.middleware"
import { roleMiddleware } from "../../middleware/role.middleware"
import { notificationChannelsController } from "./notification-channels.controller"

const router = Router()

router.use(authMiddleware)
router.use(roleMiddleware("salon_owner", "admin"))

// GET /api/v1/notification-channels/:salonId
router.get("/:salonId", notificationChannelsController.list)
// PATCH /api/v1/notification-channels/:salonId/:eventType/sms  body: { body }
router.patch("/:salonId/:eventType/sms", notificationChannelsController.updateSms)
// PATCH /api/v1/notification-channels/:salonId/:eventType/email  body: { subject, body }
router.patch("/:salonId/:eventType/email", notificationChannelsController.updateEmail)
// PATCH /api/v1/notification-channels/:salonId/:eventType/:channel/enabled  body: { enabled }
router.patch("/:salonId/:eventType/:channel/enabled", notificationChannelsController.setEnabled)
// POST /api/v1/notification-channels/:salonId/test/:channel  body: { to }
router.post("/:salonId/test/:channel", notificationChannelsController.sendTest)

export default router
