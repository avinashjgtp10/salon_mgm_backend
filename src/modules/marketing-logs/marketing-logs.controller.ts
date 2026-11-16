import { Request, Response, NextFunction } from 'express'
import { AppError } from '../../middleware/error.middleware'
import { sendSuccess } from '../utils/response.util'
import { marketingLogsRepository, ALL_SOURCES, LOG_STATUSES, LOG_ORIGINS, LogFilters, LogSource } from './marketing-logs.repository'

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const toList = (v: unknown): string[] | undefined =>
  v === undefined || v === '' ? undefined : (Array.isArray(v) ? v as string[] : String(v).split(','))

const dayStr = (d: Date) => d.toISOString().slice(0, 10)

// Same query string for the summary and the list: a date window (default the last 30 days — bounds the scan of the big log
// tables), one salon or all, source(s), status(es) and a search.
function readFilters(req: Request): LogFilters {
  const today = new Date()
  const monthAgo = new Date(Date.now() - 29 * 24 * 3600 * 1000)
  const from = isDay(req.query.from) ? req.query.from : dayStr(monthAgo)
  const to = isDay(req.query.to) ? req.query.to : dayStr(today)
  if (from > to) throw new AppError(400, 'The start date is after the end date.', 'VALIDATION_ERROR')
  if (req.query.salonId && !isUuid(req.query.salonId)) throw new AppError(400, 'Invalid salon.', 'VALIDATION_ERROR')

  const sources = toList(req.query.source)
  const badSource = sources?.find((s) => !ALL_SOURCES.includes(s as LogSource))
  if (badSource) throw new AppError(400, `Invalid source: ${badSource}`, 'VALIDATION_ERROR')
  const statuses = toList(req.query.status)
  const badStatus = statuses?.find((s) => !(LOG_STATUSES as readonly string[]).includes(s))
  if (badStatus) throw new AppError(400, `Invalid status: ${badStatus}`, 'VALIDATION_ERROR')

  const origins = toList(req.query.origin)
  const badOrigin = origins?.find((o) => !(LOG_ORIGINS as readonly string[]).includes(o))
  if (badOrigin) throw new AppError(400, `Invalid origin: ${badOrigin}`, 'VALIDATION_ERROR')

  return {
    from, to,
    salonId: isUuid(req.query.salonId) ? req.query.salonId : null,
    sources: sources as LogSource[] | undefined,
    statuses,
    origins,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
  }
}

export const marketingLogsController = {
  // GET /api/v1/super-admin/marketing-logs/summary
  async summary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = readFilters(req)
      const result = await marketingLogsRepository.summary(filters)
      sendSuccess(res, 200, { ...result, from: filters.from, to: filters.to }, 'Marketing log summary fetched')
    } catch (err) { next(err) }
  },

  // GET /api/v1/super-admin/marketing-logs
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = readFilters(req)
      const rawPage = parseInt(req.query.page as string)
      const rawLimit = parseInt(req.query.limit as string)
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20
      const result = await marketingLogsRepository.list(filters, page, limit)
      sendSuccess(res, 200, result, 'Marketing logs fetched')
    } catch (err) { next(err) }
  },
}
