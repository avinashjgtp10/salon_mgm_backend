import { Router } from 'express'
import multer from 'multer'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission, requireAnyPermission } from '../../../../middleware/permission.middleware'
import { templatesController } from './templates.controller'
import { validateCreateTemplate } from './templates.validator'

const router = Router()
// 16MB — Meta's largest template-header media cap (video); per-type caps
// (image 5MB, document 10MB) are enforced in validateCreateTemplate.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } })
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewTemplates = requirePermission('view_templates')
const addTemplate = requirePermission('add_template')
const editTemplate = requirePermission('edit_template')
const deleteTemplate = requirePermission('delete_template')
// The Marketing Dashboard (view_marketing_dashboard) lists templates as
// part of its overview — same cross-module read dependency as the
// campaigns list above. Scoped to just the list route the dashboard calls.
const viewTemplatesOrDashboard = requireAnyPermission(['view_templates', 'view_marketing_dashboard'])

// GET /api/v1/templates
router.get(
  '/',
  authMiddleware,
  ownerAdminStaff, viewTemplatesOrDashboard,
  templatesController.getAll
)

// GET /api/v1/templates/:id
router.get(
  '/:id',
  authMiddleware,
  ownerAdminStaff, viewTemplates,
  templatesController.getById
)

// POST /api/v1/templates
router.post(
  '/',
  authMiddleware,
  ownerAdminStaff, addTemplate,
  upload.single('headerFile'),
  validateCreateTemplate,
  templatesController.create
)

// PATCH /api/v1/templates/:id/media — re-upload file, update header_media_id only
router.patch(
  '/:id/media',
  authMiddleware,
  ownerAdminStaff, editTemplate,
  upload.single('headerFile'),
  templatesController.fixMedia
)

// POST /api/v1/templates/:id/sync
router.post(
  '/:id/sync',
  authMiddleware,
  ownerAdminStaff, editTemplate,
  templatesController.syncStatus
)

// DELETE /api/v1/templates/:id
router.delete(
  '/:id',
  authMiddleware,
  ownerAdminStaff, deleteTemplate,
  templatesController.delete
)
// POST /api/v1/templates/:id/favorite — toggle favorite
router.post(
  '/:id/favorite',
  authMiddleware,
  ownerAdminStaff, viewTemplates,
  templatesController.toggleFavorite
)

export default router
