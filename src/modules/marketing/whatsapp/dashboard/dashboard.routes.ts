import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { dashboardController } from './dashboard.controller'

const router = Router()

router.get(
  '/stats',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  dashboardController.getStats
)

export default router
