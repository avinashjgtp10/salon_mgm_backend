import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { validateBody } from '../../../../middleware/validation.middleware'
import { inboxController } from './inbox.controller'
import { sendReplySchema } from './inbox.validator'

const router = Router()

const auth = [authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff')]
const viewCampaigns = requirePermission('view_campaigns')
const manageCampaigns = requirePermission('create_campaigns')

// GET  /api/v1/inbox/conversations
router.get('/conversations', auth, viewCampaigns, inboxController.getConversations)

// GET  /api/v1/inbox/conversations/:phone/messages
router.get('/conversations/:phone/messages', auth, viewCampaigns, inboxController.getMessages)

// POST /api/v1/inbox/conversations/:phone/reply
router.post('/conversations/:phone/reply', auth, manageCampaigns, validateBody(sendReplySchema), inboxController.sendReply)

export default router
