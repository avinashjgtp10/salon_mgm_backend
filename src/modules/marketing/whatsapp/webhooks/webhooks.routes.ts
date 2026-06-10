import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { webhooksController } from './webhooks.controller'

const router = Router()

// ── Global endpoint — paste this URL in Meta App Dashboard ───────────────────
// GET  /api/v1/webhooks/whatsapp  ← Meta verification
// POST /api/v1/webhooks/whatsapp  ← All Meta events
// MUST be registered BEFORE /:salonId/meta to avoid route conflict
router.get('/whatsapp',  webhooksController.verifyGlobal)
router.post('/whatsapp', webhooksController.handleGlobal)

// ── Per-salon endpoints — kept for backward compatibility ─────────────────────
router.get('/:salonId/meta',  webhooksController.verify)
router.post('/:salonId/meta', webhooksController.handle)

// ── Private — frontend polling ────────────────────────────────────────────────
router.get(
  '/events',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  webhooksController.getEvents
)

export default router