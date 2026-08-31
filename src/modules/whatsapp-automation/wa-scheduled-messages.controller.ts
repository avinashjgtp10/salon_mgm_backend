// ============================================================
// SalonOx — Scheduled Templates Controller
// ============================================================

import { Request, Response, NextFunction } from 'express'
import { waScheduledMessagesService } from './wa-scheduled-messages.service'
import { sendSuccess } from '../utils/response.util'
import { AppError } from '../../middleware/error.middleware'
import { getSalonId } from '../utils/salon.util'
import { AutomationEventType, ScheduledMessageStatus, SCHEDULABLE_EVENTS } from './whatsapp-automation.types'

// Same ownership guard as whatsapp-automation.controller.ts — the :salonId
// path param is client-supplied, so without this any authenticated user
// could read another salon's scheduled messages or act on its rows.
async function resolveOwnedSalonId(req: Request): Promise<string> {
  const paramSalonId = req.params.salonId as string
  const role = (req as any).user?.role
  if (role === 'admin') return paramSalonId
  const ownSalonId = await getSalonId(req)
  if (paramSalonId !== ownSalonId) {
    throw new AppError(403, "You can only access your own salon's automation data", 'FORBIDDEN')
  }
  return ownSalonId
}

const VALID_STATUSES: ScheduledMessageStatus[] = ['SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED']

export const waScheduledMessagesController = {

  // GET /api/v1/wa-automation/scheduled/:salonId
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId   = await resolveOwnedSalonId(req)
      const status    = req.query.status    as string | undefined
      const eventType = req.query.eventType as string | undefined
      const clientId  = req.query.clientId  as string | undefined
      const dateFrom  = req.query.dateFrom  as string | undefined
      const dateTo    = req.query.dateTo    as string | undefined
      const search    = req.query.search    as string | undefined

      if (status && !VALID_STATUSES.includes(status as ScheduledMessageStatus)) {
        return next(new AppError(400, `Invalid status: ${status}`, 'VALIDATION_ERROR'))
      }
      if (eventType && !SCHEDULABLE_EVENTS.includes(eventType as AutomationEventType)) {
        return next(new AppError(400, `Invalid eventType: ${eventType}`, 'VALIDATION_ERROR'))
      }

      const rawPage  = parseInt(req.query.page  as string)
      const rawLimit = parseInt(req.query.limit as string)
      const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20

      const result = await waScheduledMessagesService.list({
        salonId,
        status:    status    as ScheduledMessageStatus | undefined,
        eventType: eventType as AutomationEventType    | undefined,
        clientId, dateFrom, dateTo, search, page, limit,
      })
      sendSuccess(res, 200, result, 'Scheduled messages fetched')
    } catch (err) { next(err) }
  },

  // POST /api/v1/wa-automation/scheduled/:salonId/:id/send-now
  async sendNow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const result = await waScheduledMessagesService.sendNow(String(req.params.id), salonId)
      if (!result.ok) return next(new AppError(400, result.reason ?? 'Could not send now', 'INVALID_STATE'))
      sendSuccess(res, 200, result, 'Message sent')
    } catch (err) { next(err) }
  },

  // POST /api/v1/wa-automation/scheduled/:salonId/:id/retry-now
  async retryNow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const result = await waScheduledMessagesService.retryNow(String(req.params.id), salonId)
      if (!result.ok) return next(new AppError(400, result.reason ?? 'Could not retry', 'INVALID_STATE'))
      sendSuccess(res, 200, result, 'Retry sent')
    } catch (err) { next(err) }
  },

  // PUT /api/v1/wa-automation/scheduled/:salonId/:id/reschedule
  // Body: { scheduled_at }
  async reschedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      if (!req.body?.scheduled_at) return next(new AppError(400, 'scheduled_at is required', 'VALIDATION_ERROR'))
      const result = await waScheduledMessagesService.reschedule(String(req.params.id), salonId, req.body.scheduled_at)
      if (!result.ok) return next(new AppError(400, result.reason ?? 'Could not reschedule', 'INVALID_STATE'))
      sendSuccess(res, 200, result, 'Rescheduled')
    } catch (err) { next(err) }
  },

  // POST /api/v1/wa-automation/scheduled/:salonId/:id/skip
  async skip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const result = await waScheduledMessagesService.skip(String(req.params.id), salonId)
      if (!result.ok) return next(new AppError(400, result.reason ?? 'Could not skip', 'INVALID_STATE'))
      sendSuccess(res, 200, result, 'Skipped')
    } catch (err) { next(err) }
  },

  // POST /api/v1/wa-automation/scheduled/:salonId/:id/cancel
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const result = await waScheduledMessagesService.cancel(String(req.params.id), salonId)
      if (!result.ok) return next(new AppError(400, result.reason ?? 'Could not cancel', 'INVALID_STATE'))
      sendSuccess(res, 200, result, 'Cancelled')
    } catch (err) { next(err) }
  },

  // POST /api/v1/wa-automation/scheduled/:salonId/:id/resend
  async resend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const result = await waScheduledMessagesService.resend(String(req.params.id), salonId)
      if (!result.ok) return next(new AppError(400, result.reason ?? 'Could not resend', 'INVALID_STATE'))
      sendSuccess(res, 200, result, 'Resent')
    } catch (err) { next(err) }
  },
}
