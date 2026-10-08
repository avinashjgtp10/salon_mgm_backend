import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { dashboardController } from './dashboard.controller'

const router = Router()

router.get(
  '/stats',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  requirePermission('view_marketing_dashboard'),
  dashboardController.getStats
)

// GET /dashboard/top-templates?page=1&limit=10
router.get(
  '/top-templates',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  requirePermission('view_marketing_dashboard'),
  dashboardController.getTopTemplatesPaged
)

// GET /dashboard/engaged-contacts?page=1&limit=10
router.get(
  '/engaged-contacts',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin', 'staff'),
  requirePermission('view_marketing_dashboard'),
  dashboardController.getEngagedContactsPaged
)

export default router
