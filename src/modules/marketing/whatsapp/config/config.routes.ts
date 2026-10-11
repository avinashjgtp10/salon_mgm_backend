import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requireAnyPermission } from '../../../../middleware/permission.middleware'
import { configController } from './config.controller'

const router = Router()

// A salon's WhatsApp credentials are entered, verified, changed and removed ONLY
// by SalonOx, from Super Admin > Salons > <salon> (config.super-admin.routes.ts,
// behind an email OTP). The salon-facing write routes - save, disconnect, test,
// sync, verify-*, AI receptionist - no longer exist. What is left is this
// read-only status check.
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')

// MarketingRoutes.tsx fetches this on EVERY Marketing page load (Dashboard,
// Analytics, Templates, ...) to decide whether WhatsApp is connected at all, so
// it stays open to anyone with a Marketing view permission. getConfig() redacts
// access_token / app_secret for every salon-side caller.
const viewWhatsappStatus = requireAnyPermission([
  'view_whatsapp_config', 'view_marketing_dashboard', 'view_marketing_analytics',
  'view_campaigns', 'view_templates', 'view_scheduled_templates', 'view_inbox',
])

router.get('/',
  authMiddleware, ownerAdminStaff, viewWhatsappStatus,
  configController.getConfig
)

export default router
