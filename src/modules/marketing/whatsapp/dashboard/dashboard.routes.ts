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
  requirePermission('view_campaigns'),
  dashboardController.getStats
)

export default router
