// ============================================================
// SalonOx — Scheduled Templates Routes
// ============================================================

import { Router } from 'express'
import { waScheduledMessagesController } from './wa-scheduled-messages.controller'
import { authMiddleware } from '../../middleware/auth.middleware'

const router = Router()

router.use(authMiddleware)

// GET /api/v1/wa-automation/scheduled/:salonId?status=&eventType=&clientId=&dateFrom=&dateTo=&search=&page=&limit=
router.get('/:salonId', waScheduledMessagesController.list)

// POST /api/v1/wa-automation/scheduled/:salonId/:id/send-now
router.post('/:salonId/:id/send-now', waScheduledMessagesController.sendNow)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/retry-now
router.post('/:salonId/:id/retry-now', waScheduledMessagesController.retryNow)
// PUT  /api/v1/wa-automation/scheduled/:salonId/:id/reschedule  body: { scheduled_at }
router.put('/:salonId/:id/reschedule', waScheduledMessagesController.reschedule)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/skip
router.post('/:salonId/:id/skip', waScheduledMessagesController.skip)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/cancel
router.post('/:salonId/:id/cancel', waScheduledMessagesController.cancel)
// POST /api/v1/wa-automation/scheduled/:salonId/:id/resend
router.post('/:salonId/:id/resend', waScheduledMessagesController.resend)

export default router
