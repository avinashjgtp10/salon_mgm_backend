import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { configController } from './config.controller'
import { validateSaveConfig } from './config.validator'

const router = Router()

// GET /api/v1/wa-config
router.get(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  configController.getConfig
)

// PUT /api/v1/wa-config
router.put(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  validateSaveConfig,
  configController.saveConfig
)

// POST /api/v1/wa-config/test
router.post(
  '/test',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  configController.testConnection
)

export default router
