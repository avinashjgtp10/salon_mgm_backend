import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { validateBody } from '../../../../middleware/validation.middleware'
import { inboxController } from './inbox.controller'
import { sendReplySchema } from './inbox.validator'

const router = Router()

const auth = [authMiddleware, roleMiddleware('salon_owner', 'admin')]

// GET  /api/v1/inbox/conversations
router.get('/conversations', auth, inboxController.getConversations)

// GET  /api/v1/inbox/conversations/:phone/messages
router.get('/conversations/:phone/messages', auth, inboxController.getMessages)

// POST /api/v1/inbox/conversations/:phone/reply
router.post('/conversations/:phone/reply', auth, validateBody(sendReplySchema), inboxController.sendReply)

export default router