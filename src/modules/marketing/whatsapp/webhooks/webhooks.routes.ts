import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { webhooksController } from './webhooks.controller'

const router = Router()

// Public — Meta calls these (no auth)
// GET  /api/v1/webhooks/:salonId/meta
router.get('/:salonId/meta',  webhooksController.verify)

// POST /api/v1/webhooks/:salonId/meta
router.post('/:salonId/meta', webhooksController.handle)

// Private — frontend polling
// GET /api/v1/webhooks/events
router.get(
  '/events',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  webhooksController.getEvents
)

export default router
