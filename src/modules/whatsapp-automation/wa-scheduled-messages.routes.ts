// ============================================================
// SalonOx — Scheduled Templates Routes
// ============================================================

import { Router } from 'express'
import { waScheduledMessagesController } from './wa-scheduled-messages.controller'
import { authMiddleware } from '../../middleware/auth.middleware'
import { roleMiddleware } from '../../middleware/role.middleware'
import { requirePermission } from '../../middleware/permission.middleware'

const router = Router()

router.use(authMiddleware)

// Previously NO role or permission check at all — same gap as
// whatsapp-automation.routes.ts, closed the same way.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewAutomation = requirePermission('view_wa_automation')
const manageAutomation = requirePermission('manage_wa_automation')

// GET /api/v1/wa-automation/scheduled/:salonId?status=&eventType=&clientId=&dateFrom=&dateTo=&search=&page=&limit=
router.get('/:salonId', ownerAdminStaff, viewAutomation, waScheduledMessagesController.list)

// POST /api/v1/wa-automation/scheduled/:salonId/:id/send-now
router.post('/:salonId/:id/send-now', ownerAdminStaff, manageAutomation, waScheduledMessagesController.sendNow)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/retry-now
router.post('/:salonId/:id/retry-now', ownerAdminStaff, manageAutomation, waScheduledMessagesController.retryNow)
// PUT  /api/v1/wa-automation/scheduled/:salonId/:id/reschedule  body: { scheduled_at }
router.put('/:salonId/:id/reschedule', ownerAdminStaff, manageAutomation, waScheduledMessagesController.reschedule)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/skip
router.post('/:salonId/:id/skip', ownerAdminStaff, manageAutomation, waScheduledMessagesController.skip)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/cancel
router.post('/:salonId/:id/cancel', ownerAdminStaff, manageAutomation, waScheduledMessagesController.cancel)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/resend
router.post('/:salonId/:id/resend', ownerAdminStaff, manageAutomation, waScheduledMessagesController.resend)

export default router
