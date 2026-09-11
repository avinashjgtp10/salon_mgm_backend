import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { analyticsController } from './analytics.controller'

const router = Router()

// GET /api/v1/marketing/analytics?start=2024-01-01&end=2024-01-31&granularity=DAY
router.get(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  requirePermission('view_marketing_analytics'),
  analyticsController.getAnalytics
)

export default router
