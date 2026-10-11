import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission, requireAnyPermission } from '../../../../middleware/permission.middleware'
import { flowsController } from './flows.controller'

const router = Router()
const ownerAdminStaff = roleMiddleware('salon_owner', 'admin', 'staff')

// GET  /api/v1/wa-flows/booking - has this salon published a booking form?
router.get('/booking',
  authMiddleware, ownerAdminStaff,
  requireAnyPermission(['view_inbox', 'view_whatsapp_config']),
  flowsController.getBooking
)

// POST /api/v1/wa-flows/booking - (re)build the form from current services and publish it
router.post('/booking',
  authMiddleware, ownerAdminStaff, requirePermission('edit_whatsapp_config'),
  flowsController.publishBooking
)

// POST /api/v1/wa-flows/booking/invite - create the invitation template (needs Meta approval)
router.post('/booking/invite',
  authMiddleware, ownerAdminStaff, requirePermission('add_template'),
  flowsController.createInvite
)

// PATCH /api/v1/wa-flows/booking/auto-send - body { enabled: boolean }
router.patch('/booking/auto-send',
  authMiddleware, ownerAdminStaff, requirePermission('edit_whatsapp_config'),
  flowsController.setAutoSend
)

export default router
