import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requireAnyPermission } from '../../../../middleware/permission.middleware'
import { sendSuccess } from '../../../utils/response.util'
import logger from '../../../../config/logger'
import { pricingService } from './pricing.service'
import { runPricingSync } from './pricing.sync.service'

// Salon-facing, read-only: /api/v1/wa-pricing
//   GET /?country=AE[&currency=AED]  prices for messaging customers in one country (Marketing > Policy)
//   GET /rates[?currency=AED]        every market's prices + the country -> market table (campaign cost estimate)
// Anyone who can open Marketing can read the price list; it is Meta's public pricing, nothing salon-private.
const router = Router()

const viewPricing = requireAnyPermission([
  'view_whatsapp_config', 'view_marketing_dashboard', 'view_marketing_analytics',
  'view_campaigns', 'view_templates', 'view_scheduled_templates', 'view_inbox',
])
const gate = [authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff'), viewPricing]

router.get('/', ...gate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await pricingService.forCountry(String(req.query.country ?? ''), req.query.currency ? String(req.query.currency) : null)
    res.setHeader('Cache-Control', 'no-store')
    return sendSuccess(res, 200, data, 'Pricing fetched successfully')
  } catch (e) { return next(e) }
})

router.get('/rates', ...gate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const salonId = (req as any).user?.salonId as string | undefined
    if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
    const data = await pricingService.allRates(salonId, req.query.currency ? String(req.query.currency) : null)
    res.setHeader('Cache-Control', 'no-store')
    return sendSuccess(res, 200, data, 'Pricing fetched successfully')
  } catch (e) { return next(e) }
})

export default router

// Super Admin only (mounted by super-admin.routes.ts, which has already run authMiddleware + superAdminMiddleware):
//   GET  /api/v1/super-admin/wa-pricing/status   when the price list was last refreshed from Meta, and any error
//   POST /api/v1/super-admin/wa-pricing/sync     refresh it now
export const pricingSuperAdminRoutes = Router()

pricingSuperAdminRoutes.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try { return sendSuccess(res, 200, await pricingService.syncStatus(), 'Pricing status fetched successfully') } catch (e) { return next(e) }
})

pricingSuperAdminRoutes.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('[wa-pricing] manual refresh requested', { adminId: (req as any).user?.userId })
    const result = await runPricingSync()
    return sendSuccess(res, result.ok ? 200 : 202, { ...result, ...(await pricingService.syncStatus()) }, result.ok ? 'Price list refreshed' : 'Price list not refreshed')
  } catch (e) { return next(e) }
})
