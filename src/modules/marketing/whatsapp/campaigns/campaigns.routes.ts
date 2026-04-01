import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { campaignsController } from './campaigns.controller'
import { validateCreateCampaign } from './campaigns.validator'

const router = Router()

// GET /api/v1/campaigns
router.get(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  campaignsController.getAll
)

// GET /api/v1/campaigns/:id
router.get(
  '/:id',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  campaignsController.getById
)

// POST /api/v1/campaigns
router.post(
  '/',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  validateCreateCampaign,
  campaignsController.create
)

// POST /api/v1/campaigns/:id/pause
router.post(
  '/:id/pause',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  campaignsController.pause
)

// POST /api/v1/campaigns/:id/resume
router.post(
  '/:id/resume',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  campaignsController.resume
)

// GET /api/v1/campaigns/:id/contacts
router.get(
  '/:id/contacts',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  campaignsController.getContacts
)

// GET /api/v1/campaigns/:id/report/:type
router.get(
  '/:id/report/:type',
  authMiddleware,
  roleMiddleware('salon_owner', 'admin'),
  campaignsController.getReport
)

export default router
