import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission, requireAnyPermission } from '../../../../middleware/permission.middleware'
import { configController } from './config.controller'
import { validateSaveConfig } from './config.validator'

const router = Router()
// Deliberately a SEPARATE key from view_campaigns/create_campaigns (see
// campaigns.routes.ts): whatsapp_configs holds plaintext access_token/
// app_secret/webhook_verify_token — being trusted to send a campaign
// should not automatically mean being trusted with the raw API
// credentials. Role gate still opened to staff (matching the same
// decision as the rest of Marketing this phase), but the permission itself
// is a separate, higher-risk opt-in an owner has to grant deliberately.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')
// Split from the old combined manage_whatsapp_config: viewing the
// connection status is a materially lower-risk grant than changing the raw
// API credentials, matching how every other module separates view/edit.
const editWhatsappConfig = requirePermission('edit_whatsapp_config')
// MarketingRoutes.tsx fetches this on EVERY Marketing page load (Dashboard,
// Analytics, Templates, ...) — not just the Config page — to decide whether
// to show the onboarding flow or the real routes at all. A staff member
// with, say, only View Marketing Dashboard would otherwise get a hard 403
// (and a wrong onboarding-fallback render) just from that background
// fetch. Only GET is widened — write/verify/delete stay locked to
// edit_whatsapp_config alone — and getConfig() already redacts
// access_token/app_secret before this response ever reaches the client.
const viewWhatsappConfigOrAnyMarketing = requireAnyPermission([
  'view_whatsapp_config', 'view_marketing_dashboard', 'view_marketing_analytics',
  'view_campaigns', 'view_templates', 'view_scheduled_templates', 'view_inbox',
])

router.get('/',
  authMiddleware, ownerAdminStaff, viewWhatsappConfigOrAnyMarketing,
  configController.getConfig
)

router.put('/',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  validateSaveConfig,
  configController.saveConfig
)

router.delete('/',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.deleteConfig
)

router.patch('/ai-receptionist',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.setAiReceptionistEnabled
)

router.post('/test',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.testConnection
)

router.post('/sync-limits',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.syncLimits
)

router.post('/verify-phone',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.verifyPhone
)

router.post('/verify-app',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.verifyApp
)

// ← Single endpoint that verifies everything on final step
router.post('/verify-all',
  authMiddleware, ownerAdminStaff, editWhatsappConfig,
  configController.verifyAll
)

export default router
