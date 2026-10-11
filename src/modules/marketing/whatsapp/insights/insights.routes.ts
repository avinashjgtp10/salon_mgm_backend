import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { sendSuccess } from '../../../utils/response.util'
import { insightsService } from './insights.service'

const router = Router()

// GET /api/v1/wa-insights?days=30 - Meta's spend + per-template results for this salon
router.get('/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  requirePermission('view_marketing_analytics'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const salonId = (req as any).user?.salonId as string | undefined
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await insightsService.getInsights(salonId, Number(req.query.days ?? 30))
      return sendSuccess(res, 200, data, 'Insights fetched successfully')
    } catch (e) { return next(e) }
  }
)

export default router
