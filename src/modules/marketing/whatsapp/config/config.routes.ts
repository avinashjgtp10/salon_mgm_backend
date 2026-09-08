import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
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
const manageWhatsappConfig = requirePermission('manage_whatsapp_config')

router.get('/',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.getConfig
)

router.put('/',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  validateSaveConfig,
  configController.saveConfig
)

router.delete('/',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.deleteConfig
)

router.patch('/ai-receptionist',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.setAiReceptionistEnabled
)

router.post('/test',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.testConnection
)

router.post('/sync-limits',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.syncLimits
)

router.post('/verify-phone',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.verifyPhone
)

router.post('/verify-app',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.verifyApp
)

// ← Single endpoint that verifies everything on final step
router.post('/verify-all',
  authMiddleware, ownerAdminStaff, manageWhatsappConfig,
  configController.verifyAll
)

export default router
