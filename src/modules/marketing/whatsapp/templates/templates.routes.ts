import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { templatesController } from './templates.controller'
import { validateCreateTemplate } from './templates.validator'

const router = Router()

// GET /api/v1/templates
router.get(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  templatesController.getAll
)

// GET /api/v1/templates/:id
router.get(
  '/:id',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  templatesController.getById
)

// POST /api/v1/templates
router.post(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  validateCreateTemplate,
  templatesController.create
)

// POST /api/v1/templates/:id/sync
router.post(
  '/:id/sync',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  templatesController.syncStatus
)

// DELETE /api/v1/templates/:id
router.delete(
  '/:id',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  templatesController.delete
)

export default router
