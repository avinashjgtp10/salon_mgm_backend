import { Router } from 'express'
import multer from 'multer'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { templatesController } from './templates.controller'
import { validateCreateTemplate } from './templates.validator'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

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
  upload.single('headerFile'),
  validateCreateTemplate,
  templatesController.create
)

// PATCH /api/v1/templates/:id/media — re-upload file, update header_media_id only
router.patch(
  '/:id/media',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  upload.single('headerFile'),
  templatesController.fixMedia
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
// POST /api/v1/templates/:id/favorite — toggle favorite
router.post(
  '/:id/favorite',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  templatesController.toggleFavorite
)

export default router