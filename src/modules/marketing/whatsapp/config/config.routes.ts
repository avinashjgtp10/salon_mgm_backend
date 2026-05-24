import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { configController } from './config.controller'
import { validateSaveConfig } from './config.validator'

const router = Router()

router.get('/',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  configController.getConfig
)

router.put('/',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  validateSaveConfig,
  configController.saveConfig
)

router.post('/test',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  configController.testConnection
)

router.post('/sync-limits',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  configController.syncLimits
)

router.post('/verify-phone',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  configController.verifyPhone
)

router.post('/verify-app',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  configController.verifyApp
)

// ← Single endpoint that verifies everything on final step
router.post('/verify-all',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  configController.verifyAll
)

export default router