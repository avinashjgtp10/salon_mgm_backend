// ============================================================
// SalonOx — WhatsApp Automation Controller
// ============================================================

import { Request, Response, NextFunction } from 'express'
import { whatsappAutomationService } from './whatsapp-automation.service'
import { sendSuccess } from '../utils/response.util'
import { AutomationEventType, AutomationLogStatus } from './whatsapp-automation.types'

export const whatsappAutomationController = {

  // ── Logs ──────────────────────────────────────────────────────────────────

  // GET /api/v1/wa-automation/logs/:salonId
  async getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId   = req.params.salonId as string
      const eventType = req.query.eventType as AutomationEventType | undefined
      const status    = req.query.status    as AutomationLogStatus  | undefined
      const clientId  = req.query.clientId  as string               | undefined
      const page      = req.query.page  ? parseInt(req.query.page  as string) : 1
      const limit     = req.query.limit ? parseInt(req.query.limit as string) : 20

      const result = await whatsappAutomationService.getLogs({ salonId, eventType, status, clientId, page, limit })
      sendSuccess(res, 200, result, 'Automation logs fetched')
    } catch (err) { next(err) }
  },

  // ── Salon Settings ────────────────────────────────────────────────────────

  // GET /api/v1/wa-automation/settings/:salonId
  async getSalonSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId  = req.params.salonId as string
      const settings = await whatsappAutomationService.getSalonSettings(salonId)
      sendSuccess(res, 200, settings, 'Salon automation settings fetched')
    } catch (err) { next(err) }
  },

  // PUT /api/v1/wa-automation/settings/:salonId
  // Body: { event_type, is_active }
  async updateSalonSetting(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = req.params.salonId as string
      const updated = await whatsappAutomationService.updateSalonSetting(salonId, req.body)
      sendSuccess(res, 200, updated, 'Salon automation setting updated')
    } catch (err) { next(err) }
  },

  // ── Global Template Management (SalonOx Admin Only) ───────────────────────

  // GET /api/v1/wa-automation/templates
  async getAllTemplates(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const templates = await whatsappAutomationService.getAllTemplates()
      sendSuccess(res, 200, templates, 'Automation templates fetched')
    } catch (err) { next(err) }
  },

  // PUT /api/v1/wa-automation/templates/:eventType
  // Body: { template_name, language }
  async updateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const eventType    = req.params.eventType as AutomationEventType
      const { template_name, language } = req.body
      const updated = await whatsappAutomationService.updateTemplate(eventType, template_name, language ?? 'en')
      sendSuccess(res, 200, updated, 'Template updated')
    } catch (err) { next(err) }
  },

  // PATCH /api/v1/wa-automation/templates/:eventType/toggle
  // Body: { is_active }
  async toggleTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const eventType = req.params.eventType as AutomationEventType
      const { is_active } = req.body
      const updated = await whatsappAutomationService.toggleTemplate(eventType, is_active)
      sendSuccess(res, 200, updated, `Template ${is_active ? 'enabled' : 'disabled'}`)
    } catch (err) { next(err) }
  },

  // ── Test / Manual Trigger (Dev Only) ─────────────────────────────────────
  // POST /api/v1/wa-automation/run-job/:jobName
  // jobName: birthday | pending-payment | membership-renewal | we-miss-you-30 | we-miss-you-60 | we-miss-you-90 | new-year | appointment-reminder
  async runJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const job = req.params.jobName as string
      switch (job) {
        case 'birthday':
          await whatsappAutomationService.runBirthdayWishes(); break
        case 'pending-payment':
          await whatsappAutomationService.runPendingPaymentReminders(); break
        case 'membership-renewal':
          await whatsappAutomationService.runMembershipRenewalReminders(); break
        case 'we-miss-you-30':
          await whatsappAutomationService.runWeMissYou(30); break
        case 'we-miss-you-60':
          await whatsappAutomationService.runWeMissYou(60); break
        case 'we-miss-you-90':
          await whatsappAutomationService.runWeMissYou(90); break
        case 'new-year':
          await whatsappAutomationService.runNewYearCampaign(); break
        case 'appointment-reminder':
          await whatsappAutomationService.runAppointmentReminders(); break
        default:
          res.status(400).json({ error: `Unknown job: ${job}` }); return
      }
      sendSuccess(res, 200, { job }, `Job "${job}" executed`)
    } catch (err) { next(err) }
  },
}