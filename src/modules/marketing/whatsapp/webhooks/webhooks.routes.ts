import { Router } from 'express'
import { webhooksController } from './webhooks.controller'

const router = Router()

// ── Global endpoint — paste this URL in Meta App Dashboard ───────────────────
// GET  /api/v1/webhooks/whatsapp  ← Meta verification
// POST /api/v1/webhooks/whatsapp  ← All Meta events
// MUST be registered BEFORE /:salonId/meta to avoid route conflict
router.get('/whatsapp',  webhooksController.verifyGlobal)
router.post('/whatsapp', webhooksController.handleGlobal)

// Root of this router — so mounting it at a bare "/webhook" (see app.ts alias)
// makes GET/POST /webhook resolve to the same global handlers, matching Meta
// app configs that use the short callback path.
router.get('/',  webhooksController.verifyGlobal)
router.post('/', webhooksController.handleGlobal)

// ── Per-salon endpoints — kept for backward compatibility ─────────────────────
router.get('/:salonId/meta',  webhooksController.verify)
router.post('/:salonId/meta', webhooksController.handle)

export default router