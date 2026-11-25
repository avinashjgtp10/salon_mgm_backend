import { Router, Request, Response, NextFunction } from 'express'
import { AppError } from '../../middleware/error.middleware'
import { sendSuccess } from '../utils/response.util'
import { platformScheduledMessagesService, ListParams } from './platform-scheduled-messages.service'
import { PLATFORM_MESSAGE_STATUSES } from './platform-scheduled-messages.rules'

// Mounted under /api/v1/super-admin/scheduled-messages, behind authMiddleware + superAdminMiddleware (see super-admin.routes.ts).
const router = Router()

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const toList = (v: unknown): string[] | undefined =>
  v === undefined || v === '' ? undefined : (Array.isArray(v) ? v.map(String) : String(v).split(','))

// GET /api/v1/super-admin/scheduled-messages?view=upcoming|history&status=&dateFrom=&dateTo=&search=&sort=&page=&limit=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = req.query.view === 'history' ? 'history' : 'upcoming'
    if (req.query.dateFrom && !isDay(req.query.dateFrom)) throw new AppError(400, 'Invalid start date.', 'VALIDATION_ERROR')
    if (req.query.dateTo && !isDay(req.query.dateTo)) throw new AppError(400, 'Invalid end date.', 'VALIDATION_ERROR')
    const dateFrom = isDay(req.query.dateFrom) ? req.query.dateFrom : undefined
    const dateTo = isDay(req.query.dateTo) ? req.query.dateTo : undefined
    if (dateFrom && dateTo && dateFrom > dateTo) throw new AppError(400, 'The start date is after the end date.', 'VALIDATION_ERROR')

    const statuses = toList(req.query.status)
    const badStatus = statuses?.find((s) => !(PLATFORM_MESSAGE_STATUSES as string[]).includes(s))
    if (badStatus) throw new AppError(400, `Invalid status: ${badStatus}`, 'VALIDATION_ERROR')

    const rawPage = parseInt(req.query.page as string)
    const rawLimit = parseInt(req.query.limit as string)
    const params: ListParams = {
      view,
      statuses,
      dateFrom,
      dateTo,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      // Upcoming reads soonest first; history newest first, unless the caller says otherwise.
      sort: req.query.sort === 'latest' ? 'latest' : req.query.sort === 'soonest' ? 'soonest' : view === 'history' ? 'latest' : 'soonest',
      page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
      limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10,
    }
    sendSuccess(res, 200, await platformScheduledMessagesService.list(params), 'Scheduled messages fetched')
  } catch (err) { next(err) }
})

// A reminder is identified by its subscription and which reminder of the run it is (5, 4, 3, 2, 1 or 0 days before the end).
function readTarget(req: Request): { subscriptionId: string; daysBefore: number } {
  const { subscriptionId, daysBefore } = req.body ?? {}
  if (!isUuid(subscriptionId)) throw new AppError(400, 'Invalid subscription.', 'VALIDATION_ERROR')
  if (typeof daysBefore !== 'number') throw new AppError(400, 'Invalid reminder.', 'VALIDATION_ERROR')
  return { subscriptionId, daysBefore }
}
const adminId = (req: Request): string | null => {
  const id = (req as Request & { user?: { userId?: string } }).user?.userId
  return isUuid(id) ? id : null
}

// POST .../send-now      { subscriptionId, daysBefore }   send it now instead of at its slot
router.post('/send-now', async (req, res, next) => {
  try {
    const t = readTarget(req)
    sendSuccess(res, 200, await platformScheduledMessagesService.sendNow(t.subscriptionId, t.daysBefore), 'Sent')
  } catch (err) { next(err) }
})

// POST .../resend        { subscriptionId, daysBefore }   send one that already went out (or failed) again
router.post('/resend', async (req, res, next) => {
  try {
    const t = readTarget(req)
    sendSuccess(res, 200, await platformScheduledMessagesService.resend(t.subscriptionId, t.daysBefore), 'Sent again')
  } catch (err) { next(err) }
})

// POST .../reschedule    { subscriptionId, daysBefore, sendAt }   sendAt = ISO instant
router.post('/reschedule', async (req, res, next) => {
  try {
    const t = readTarget(req)
    const sendAt = new Date(req.body?.sendAt)
    sendSuccess(res, 200, await platformScheduledMessagesService.reschedule(t.subscriptionId, t.daysBefore, sendAt, adminId(req)), 'Rescheduled')
  } catch (err) { next(err) }
})

// POST .../skip          { subscriptionId, daysBefore }   this one reminder is not sent
router.post('/skip', async (req, res, next) => {
  try {
    const t = readTarget(req)
    sendSuccess(res, 200, await platformScheduledMessagesService.skip(t.subscriptionId, t.daysBefore, adminId(req)), 'Skipped')
  } catch (err) { next(err) }
})

// POST .../cancel        { subscriptionId, daysBefore }   none of this subscription's remaining reminders are sent
router.post('/cancel', async (req, res, next) => {
  try {
    const t = readTarget(req)
    sendSuccess(res, 200, await platformScheduledMessagesService.cancel(t.subscriptionId, t.daysBefore, adminId(req)), 'Cancelled')
  } catch (err) { next(err) }
})

export default router
