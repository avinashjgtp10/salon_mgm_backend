import { Router } from 'express'
import multer from 'multer'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { templatesController } from './templates.controller'
import { validateCreateTemplate } from './templates.validator'

const router = Router()
// 16MB — Meta's largest template-header media cap (video); per-type caps
// (image 5MB, document 10MB) are enforced in validateCreateTemplate.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } })
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewCampaigns = requirePermission('view_campaigns')
const manageCampaigns = requirePermission('create_campaigns')

// GET /api/v1/templates
router.get(
  '/',
  authMiddleware,
  ownerAdminStaff, viewCampaigns,
  templatesController.getAll
)

// GET /api/v1/templates/:id
router.get(
  '/:id',
  authMiddleware,
  ownerAdminStaff, viewCampaigns,
  templatesController.getById
)

// POST /api/v1/templates
router.post(
  '/',
  authMiddleware,
  ownerAdminStaff, manageCampaigns,
  upload.single('headerFile'),
  validateCreateTemplate,
  templatesController.create
)

// PATCH /api/v1/templates/:id/media — re-upload file, update header_media_id only
router.patch(
  '/:id/media',
  authMiddleware,
  ownerAdminStaff, manageCampaigns,
  upload.single('headerFile'),
  templatesController.fixMedia
)

// POST /api/v1/templates/:id/sync
router.post(
  '/:id/sync',
  authMiddleware,
  ownerAdminStaff, manageCampaigns,
  templatesController.syncStatus
)

// DELETE /api/v1/templates/:id
router.delete(
  '/:id',
  authMiddleware,
  ownerAdminStaff, manageCampaigns,
  templatesController.delete
)
// POST /api/v1/templates/:id/favorite — toggle favorite
router.post(
  '/:id/favorite',
  authMiddleware,
  ownerAdminStaff, viewCampaigns,
  templatesController.toggleFavorite
)

export default router
