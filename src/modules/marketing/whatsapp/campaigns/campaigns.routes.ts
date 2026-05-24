import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { campaignsController } from './campaigns.controller'
import { validateCreateCampaign } from './campaigns.validator'

const router = Router()

router.get('/',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  campaignsController.getAll
)

router.get('/:id',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  campaignsController.getById
)

router.post('/',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  validateCreateCampaign,
  campaignsController.create
)

router.post('/:id/pause',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  campaignsController.pause
)

router.post('/:id/resume',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  campaignsController.resume
)

router.get('/:id/contacts',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  campaignsController.getContacts
)

router.get('/:id/report/:type',
  authMiddleware, roleMiddleware('salon_owner', 'admin'),
  campaignsController.getReport
)

export default router