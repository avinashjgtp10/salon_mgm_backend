import { Router } from 'express'
import multer from 'multer'
import { authMiddleware } from '../../../../middleware/auth.middleware'
import { roleMiddleware } from '../../../../middleware/role.middleware'
import { requirePermission } from '../../../../middleware/permission.middleware'
import { validateBody } from '../../../../middleware/validation.middleware'
import { inboxController } from './inbox.controller'
import { flowsController } from '../flows/flows.controller'
import { sendReplySchema, sendTemplateSchema } from './inbox.validator'

const router = Router()
// Files are held in memory just long enough to hand to Meta; 16 MB is WhatsApp's cap for video/audio.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } })

const auth = [authMiddleware, roleMiddleware('salon_owner', 'admin', 'staff')]
const viewInbox = requirePermission('view_inbox')
// Trimmed from 4 keys to 2 on request: view_conversation was redundant with
// view_inbox (opening a thread is just part of using the inbox, not a
// separate real gate), and send_message/reply_to_conversation were the same
// single action under two names — reply_to_conversation kept as the
// survivor since it matches this route's actual name.
const replyToConversation = requirePermission('reply_to_conversation')

// GET  /api/v1/inbox/unread-count — { unread } total across all conversations (sidebar badge)
router.get('/unread-count', auth, viewInbox, inboxController.getUnreadCount)

// GET  /api/v1/inbox/conversations
router.get('/conversations', auth, viewInbox, inboxController.getConversations)

// GET  /api/v1/inbox/conversations/:phone/messages
router.get('/conversations/:phone/messages', auth, viewInbox, inboxController.getMessages)

// GET  /api/v1/inbox/conversations/:phone/customer — Customer Info sidebar
router.get('/conversations/:phone/customer', auth, viewInbox, inboxController.getCustomerInfo)

// GET  /api/v1/inbox/media/:mediaId — bytes of an image/video/document shown in a thread
router.get('/media/:mediaId', auth, viewInbox, inboxController.getMedia)

// POST /api/v1/inbox/conversations/:phone/typing — shows "typing…" on the customer's phone
router.post('/conversations/:phone/typing', auth, replyToConversation, inboxController.typing)

// POST /api/v1/inbox/conversations/:phone/media - send a photo / video / audio / document
router.post('/conversations/:phone/media', auth, replyToConversation, upload.single('file'), inboxController.sendMedia)

// POST /api/v1/inbox/messages/:id/react - emoji reaction to a message ({ emoji }, '' removes)
router.post('/messages/:id/react', auth, replyToConversation, inboxController.react)

// POST /api/v1/inbox/conversations/delete - delete one or many conversations and all their messages ({ phones: [...] }).
// Same permission as replying: anyone who can work a conversation can clear it.
router.post('/conversations/delete', auth, replyToConversation, inboxController.deleteConversations)

// POST /api/v1/inbox/conversations/:phone/reply
router.post('/conversations/:phone/reply', auth, replyToConversation, validateBody(sendReplySchema), inboxController.sendReply)

// POST /api/v1/inbox/conversations/:phone/template — send an approved template
// (the only message type Meta allows once the 24hr window has closed)
router.post('/conversations/:phone/template', auth, replyToConversation, validateBody(sendTemplateSchema), inboxController.sendTemplate)

// POST /api/v1/inbox/conversations/:phone/flow - send the booking form (WhatsApp Flow)
router.post('/conversations/:phone/flow', auth, replyToConversation, flowsController.sendBooking)

export default router
