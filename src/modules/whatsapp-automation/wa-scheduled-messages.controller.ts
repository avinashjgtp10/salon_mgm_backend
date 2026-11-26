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

const HISTORY_STATUSES = ['SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED']
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const toList = (v: unknown): string[] | undefined =>
  v === undefined ? undefined : (Array.isArray(v) ? v as string[] : [v as string])

export const waScheduledMessagesController = {

  // GET /api/v1/wa-automation/scheduled/history/:salonId/summary?dateFrom=&dateTo=
  async historySummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const dateFrom = isDay(req.query.dateFrom) ? req.query.dateFrom : undefined
      const dateTo   = isDay(req.query.dateTo)   ? req.query.dateTo   : undefined
      const result = await waScheduledMessagesService.historySummary({ salonId, dateFrom, dateTo })
      sendSuccess(res, 200, result, 'History summary fetched')
    } catch (err) { next(err) }
  },

  // GET /api/v1/wa-automation/scheduled/history/:salonId?eventType=&status=&dateFrom=&dateTo=&search=&page=&limit=
  async historyList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId = await resolveOwnedSalonId(req)
      const status = toList(req.query.status)
      const invalid = status?.find(s => !HISTORY_STATUSES.includes(s))
      if (invalid) return next(new AppError(400, `Invalid status: ${invalid}`, 'VALIDATION_ERROR'))
      const rawPage  = parseInt(req.query.page as string)
      const rawLimit = parseInt(req.query.limit as string)
      const result = await waScheduledMessagesService.historyList({
        salonId,
        dateFrom:  isDay(req.query.dateFrom) ? req.query.dateFrom : undefined,
        dateTo:    isDay(req.query.dateTo)   ? req.query.dateTo   : undefined,
        eventType: toList(req.query.eventType),
        status,
        search:    typeof req.query.search === 'string' ? req.query.search : undefined,
        page:      Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage : 1,
        limit:     Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20,
      })
      sendSuccess(res, 200, result, 'History fetched')
    } catch (err) { next(err) }
  },

  // GET /api/v1/wa-automation/scheduled/:salonId
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const salonId   = await resolveOwnedSalonId(req)
      // Express parses repeated query keys (status=A&status=B, which is how
      // axios serializes an array `params` value) into a real array already —
      // a single checkbox still arrives as a plain string, so both are
      // normalized to string[] here.
      const toArray = (v: unknown): string[] | undefined =>
        v === undefined ? undefined : (Array.isArray(v) ? v as string[] : [v as string])
      const status    = toArray(req.query.status)
      const eventType = toArray(req.query.eventType)
      const clientId  = req.query.clientId  as string | undefined
      // Days are the salon's own calendar days ('YYYY-MM-DD'); anything else is refused here instead of failing in the database.
      if ((req.query.dateFrom && !isDay(req.query.dateFrom)) || (req.query.dateTo && !isDay(req.query.dateTo))) {
        return next(new AppError(400, 'Dates must look like 2026-11-25', 'VALIDATION_ERROR'))
      }
      const dateFrom  = isDay(req.query.dateFrom) ? req.query.dateFrom : undefined
      const dateTo    = isDay(req.query.dateTo)   ? req.query.dateTo   : undefined
      const search    = req.query.search    as string | undefined

      const invalidStatus = status?.find(s => !VALID_STATUSES.includes(s as ScheduledMessageStatus))
      if (invalidStatus) {
        return next(new AppError(400, `Invalid status: ${invalidStatus}`, 'VALIDATION_ERROR'))
      }
      const invalidEventType = eventType?.find(e => !SCHEDULABLE_EVENTS.includes(e as AutomationEventType))
      if (invalidEventType) {
        return next(new AppError(400, `Invalid eventType: ${invalidEventType}`, 'VALIDATION_ERROR'))
      }

      const rawPage  = parseInt(req.query.page  as string)
      const rawLimit = parseInt(req.query.limit as string)
      const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20

      const result = await waScheduledMessagesService.list({
        salonId,
        status:    status    as ScheduledMessageStatus[] | undefined,
        eventType: eventType as AutomationEventType[]    | undefined,
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
