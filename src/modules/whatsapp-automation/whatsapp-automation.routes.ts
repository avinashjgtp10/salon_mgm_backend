// ============================================================
// SalonOx — WhatsApp Automation Routes
// ============================================================

import { Router } from 'express'
import { whatsappAutomationController } from './whatsapp-automation.controller'
import { authMiddleware } from '../../middleware/auth.middleware'
import { roleMiddleware } from '../../middleware/role.middleware'

const router = Router()

router.use(authMiddleware)

// ── Message Logs ──────────────────────────────────────────────────────────────
// GET /api/v1/wa-automation/logs/:salonId?eventType=&status=&clientId=&page=&limit=
router.get('/logs/:salonId', whatsappAutomationController.getLogs)

// ── Per-Salon Settings ────────────────────────────────────────────────────────
// GET /api/v1/wa-automation/settings/:salonId
router.get('/settings/:salonId', whatsappAutomationController.getSalonSettings)
// PUT /api/v1/wa-automation/settings/:salonId  body: { event_type, is_active }
router.put('/settings/:salonId', whatsappAutomationController.updateSalonSetting)

// ── Global Template Management (SalonOx admin) ────────────────────────────────
// GET  /api/v1/wa-automation/templates
router.get('/templates', whatsappAutomationController.getAllTemplates)
// PUT  /api/v1/wa-automation/templates/:eventType  body: { template_name, language }
router.put('/templates/:eventType', whatsappAutomationController.updateTemplate)
// PATCH /api/v1/wa-automation/templates/:eventType/toggle  body: { is_active }
router.patch('/templates/:eventType/toggle', whatsappAutomationController.toggleTemplate)

// ── Manual Job Trigger (Admin Only) ──────────────────────────────────────────
// POST /api/v1/wa-automation/run-job/:jobName
// jobName: birthday | pending-payment | membership-renewal | we-miss-you-30 | we-miss-you-60 | we-miss-you-90 | new-year | appointment-reminder
router.post('/run-job/:jobName', roleMiddleware('admin'), whatsappAutomationController.runJob)

export default router