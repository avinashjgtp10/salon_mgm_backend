import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePlanFeature } from '../../../../middleware/planFeature.middleware'
import { requirePermission, requireAnyPermission } from '../../../../middleware/permission.middleware'
import { campaignsController } from './campaigns.controller'
import { validateCreateCampaign } from './campaigns.validator'

const router = Router()
// Previously owner/admin-only with no permission check at all — staff
// excluded entirely, so view_campaigns/create_campaigns (already in the
// catalog since Phase 1) were dead. Opened to staff this phase.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
const viewCampaigns = requirePermission('view_campaigns')
const manageCampaigns = requirePermission('create_campaigns')
// Send Campaign (pause/resume/resend an EXISTING campaign) is its own
// dedicated key, distinct from create_campaigns (making a brand new one).
// edit_campaign/delete_campaign exist in the catalog for completeness (the
// ticket asks for the toggles) but have no route to wire to — there is no
// edit or delete action for a campaign anywhere in this app today.
const sendCampaign = requirePermission('send_campaign')
// The Marketing Dashboard (view_marketing_dashboard) lists recent campaigns
// as part of its overview — same cross-module read dependency as the
// Payroll/WhatsApp-config fixes elsewhere in this ticket. Scoped to just
// the list route the dashboard actually calls.
const viewCampaignsOrDashboard = requireAnyPermission(['view_campaigns', 'view_marketing_dashboard'])

// featureKey "marketing" — Advance tier and up (see
// Migration/add_feature_key_to_salon_plans.sql). See inventory.routes.ts for
// the same router.use() pattern and why authMiddleware needs repeating here
// even though each route below also calls it.
router.use(authMiddleware, requirePlanFeature('marketing'))

router.get('/',
  authMiddleware, ownerAdminStaff, viewCampaignsOrDashboard,
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
  authMiddleware, ownerAdminStaff, sendCampaign,
  campaignsController.resend
)

router.post('/:id/pause',
  authMiddleware, ownerAdminStaff, sendCampaign,
  campaignsController.pause
)

router.post('/:id/resume',
  authMiddleware, ownerAdminStaff, sendCampaign,
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
