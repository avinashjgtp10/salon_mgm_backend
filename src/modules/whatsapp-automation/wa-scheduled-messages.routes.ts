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

// Previously used the unrelated Automation module's view_wa_automation/
// manage_wa_automation — replaced with Scheduled Templates' own dedicated
// keys per the Marketing permissions ticket. view_wa_automation/
// manage_wa_automation remain in use elsewhere (whatsapp-automation.routes.ts's
// message-log/settings endpoints), untouched — out of scope here.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewScheduledTemplates = requirePermission('view_scheduled_templates')
const editScheduledTemplate = requirePermission('edit_scheduled_template')
const deleteScheduledTemplate = requirePermission('delete_scheduled_template')
const sendNowScheduledTemplate = requirePermission('send_now_scheduled_template')
const resendScheduledTemplate = requirePermission('resend_scheduled_template')

// GET /api/v1/wa-automation/scheduled/:salonId?status=&eventType=&clientId=&dateFrom=&dateTo=&search=&page=&limit=
router.get('/:salonId', ownerAdminStaff, viewScheduledTemplates, waScheduledMessagesController.list)

// POST /api/v1/wa-automation/scheduled/:salonId/:id/send-now
router.post('/:salonId/:id/send-now', ownerAdminStaff, sendNowScheduledTemplate, waScheduledMessagesController.sendNow)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/retry-now — same bucket
// as Send Now: retrying is just sending again after a failure.
router.post('/:salonId/:id/retry-now', ownerAdminStaff, sendNowScheduledTemplate, waScheduledMessagesController.retryNow)
// PUT  /api/v1/wa-automation/scheduled/:salonId/:id/reschedule  body: { scheduled_at }
router.put('/:salonId/:id/reschedule', ownerAdminStaff, editScheduledTemplate, waScheduledMessagesController.reschedule)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/skip — same bucket as
// Cancel: both remove a pending send, no dedicated key for the distinction.
router.post('/:salonId/:id/skip', ownerAdminStaff, deleteScheduledTemplate, waScheduledMessagesController.skip)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/cancel
router.post('/:salonId/:id/cancel', ownerAdminStaff, deleteScheduledTemplate, waScheduledMessagesController.cancel)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/resend
router.post('/:salonId/:id/resend', ownerAdminStaff, resendScheduledTemplate, waScheduledMessagesController.resend)

export default router
