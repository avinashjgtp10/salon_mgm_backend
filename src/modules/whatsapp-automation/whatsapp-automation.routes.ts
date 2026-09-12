// ============================================================
// SalonOx — WhatsApp Automation Routes
// ============================================================

import { Router } from 'express'
import { whatsappAutomationController } from './whatsapp-automation.controller'
import { authMiddleware } from '../../middleware/auth.middleware'
import { roleMiddleware } from '../../middleware/role.middleware'
import { requirePermission, requireAnyPermission } from '../../middleware/permission.middleware'

const router = Router()

router.use(authMiddleware)

// Previously these two routes had NO role check at all — any authenticated
// user could reach them (weaker than the sibling Marketing/Campaigns module,
// which over-restricted the other way by excluding staff entirely). Added
// the standard salon role gate plus real permission checks.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewAutomation = requirePermission('view_wa_automation')
// view_wa_automation/manage_wa_automation have no catalog row (an older,
// pre-existing gap — see the Marketing permissions ticket's notes) so there
// is no toggle anywhere for an owner to ever grant them. The Templates
// page's Trigger Templates tab reads/writes this same salon-settings
// endpoint for its per-event WhatsApp toggle, so it needs its own
// view_templates/edit_template OR-fallback the same as the Automation Logs
// page's own key — otherwise a staff member with View/Edit Template has no
// way to use half of the Templates page they were explicitly granted.
const viewAutomationOrTemplates = requireAnyPermission(['view_wa_automation', 'view_templates'])
const manageAutomationOrTemplates = requireAnyPermission(['manage_wa_automation', 'edit_template'])

// ── Message Logs ──────────────────────────────────────────────────────────────
// GET /api/v1/wa-automation/logs/:salonId?eventType=&status=&clientId=&page=&limit=
router.get('/logs/:salonId', ownerAdminStaff, viewAutomation, whatsappAutomationController.getLogs)

// ── Per-Salon Settings ────────────────────────────────────────────────────────
// GET /api/v1/wa-automation/settings/:salonId
router.get('/settings/:salonId', ownerAdminStaff, viewAutomationOrTemplates, whatsappAutomationController.getSalonSettings)
// PUT /api/v1/wa-automation/settings/:salonId  body: { event_type, is_active }
router.put('/settings/:salonId', ownerAdminStaff, manageAutomationOrTemplates, whatsappAutomationController.updateSalonSetting)

// ── Global Template Management (SalonOx internal admin, not a salon
// permission — unchanged, this is a different "admin" concept entirely) ──────
// GET  /api/v1/wa-automation/templates
router.get('/templates', roleMiddleware('admin'), whatsappAutomationController.getAllTemplates)
// PUT  /api/v1/wa-automation/templates/:eventType  body: { template_name, language }
router.put('/templates/:eventType', roleMiddleware('admin'), whatsappAutomationController.updateTemplate)
// PATCH /api/v1/wa-automation/templates/:eventType/toggle  body: { is_active }
router.patch('/templates/:eventType/toggle', roleMiddleware('admin'), whatsappAutomationController.toggleTemplate)

// ── Manual Job Trigger (Admin Only) ──────────────────────────────────────────
// POST /api/v1/wa-automation/run-job/:jobName
// jobName: scheduled-due-tick | scheduled-group-b-preview
// (package/membership expiry, appointment reminders, birthday, we-miss-you,
// new-year, and pending-payment all moved to Scheduled Templates — see
// wa-scheduled-messages.routes.ts for their own list/action endpoints)
router.post('/run-job/:jobName', roleMiddleware('admin'), whatsappAutomationController.runJob)

export default router
