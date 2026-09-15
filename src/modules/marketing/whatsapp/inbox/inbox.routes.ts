import { Router } from 'express'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { validateBody } from '../../../../middleware/validation.middleware'
import { inboxController } from './inbox.controller'
import { sendReplySchema } from './inbox.validator'

const router = Router()

const auth = [authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff')]
const viewInbox = requirePermission('view_inbox')
// Trimmed from 4 keys to 2 on request: view_conversation was redundant with
// view_inbox (opening a thread is just part of using the inbox, not a
// separate real gate), and send_message/reply_to_conversation were the same
// single action under two names — reply_to_conversation kept as the
// survivor since it matches this route's actual name.
const replyToConversation = requirePermission('reply_to_conversation')

// GET  /api/v1/inbox/conversations
router.get('/conversations', auth, viewInbox, inboxController.getConversations)

// GET  /api/v1/inbox/conversations/:phone/messages
router.get('/conversations/:phone/messages', auth, viewInbox, inboxController.getMessages)

// POST /api/v1/inbox/conversations/:phone/reply
router.post('/conversations/:phone/reply', auth, replyToConversation, validateBody(sendReplySchema), inboxController.sendReply)

export default router
