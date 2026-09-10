import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePlanFeature } from '../../../../middleware/planFeature.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { campaignsController } from './campaigns.controller'
import { validateCreateCampaign } from './campaigns.validator'

const router = Router()
// Previously owner/admin-only with no permission check at all — staff
// excluded entirely, so view_campaigns/create_campaigns (already in the
// catalog since Phase 1) were dead. Opened to staff this phase.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewCampaigns = requirePermission('view_campaigns')
const manageCampaigns = requirePermission('create_campaigns')

// featureKey "marketing" — Advance tier and up (see
// Migration/add_feature_key_to_salon_plans.sql). See inventory.routes.ts for
// the same router.use() pattern and why authMiddleware needs repeating here
// even though each route below also calls it.
router.use(authMiddleware, requirePlanFeature('marketing'))

router.get('/',
  authMiddleware, ownerAdminStaff, viewCampaigns,
  campaignsController.getAll
)

router.get('/:id',
  authMiddleware, ownerAdminStaff, viewCampaigns,
  campaignsController.getById
)

router.post('/',
  authMiddleware, ownerAdminStaff, manageCampaigns,
  validateCreateCampaign,
  campaignsController.create
)

router.post('/:id/resend',
  authMiddleware, ownerAdminStaff, manageCampaigns,
  campaignsController.resend
)

router.post('/:id/pause',
  authMiddleware, ownerAdminStaff, manageCampaigns,
  campaignsController.pause
)

router.post('/:id/resume',
  authMiddleware, ownerAdminStaff, manageCampaigns,
  campaignsController.resume
)

router.get('/:id/contacts',
  authMiddleware, ownerAdminStaff, viewCampaigns,
  campaignsController.getContacts
)

router.get('/:id/report/:type',
  authMiddleware, ownerAdminStaff, viewCampaigns,
  campaignsController.getReport
)

export default router
