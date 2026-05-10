import { AppError } from '../../../../middleware/error.middleware'
import { inboxRepository } from './inbox.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { configRepository } from '../config/config.repository'
import { getIO } from '../../../../config/socket'

export const inboxService = {

  async getConversations(salonId: string) {
    return inboxRepository.getConversations(salonId)
  },

  async getMessages(salonId: string, phone: string) {
    // Fire-and-forget — don't block message fetch on unread reset
    inboxRepository.markConversationRead(salonId, phone).catch(() => {})
    return inboxRepository.getMessages(salonId, phone)
  },

  async sendReply(salonId: string, phone: string, message: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    const result = await whatsappMetaApi.sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken:   config.access_token,
      to:            phone,
      message,
    })

    const wamid = result.messages?.[0]?.id ?? null

    const conversationId = await inboxRepository.upsertConversation(
      salonId, phone, null, message, false
    )

    return inboxRepository.insertMessage({
      conversationId,
      salonId,
      direction: 'OUTBOUND',
      body:      message,
      wamid,
      status:    'SENT',
    })
  },

  async handleInboundMessage(params: {
    salonId: string
    phone:   string
    name:    string | null
    body:    string
    wamid:   string
  }) {
    const conversationId = await inboxRepository.upsertConversation(
      params.salonId, params.phone, params.name, params.body, true
    )

    const message = await inboxRepository.insertMessage({
      conversationId,
      salonId:   params.salonId,
      direction: 'INBOUND',
      body:      params.body,
      wamid:     params.wamid,
      status:    'DELIVERED',
    })

    try {
      const io = getIO()
      io.to(`salon:${params.salonId}`).emit('inbox:message', {
        salonId:      params.salonId,
        contactPhone: params.phone,
        contactName:  params.name,
        message,
      })
      const conversations = await inboxRepository.getConversations(params.salonId)
      io.to(`salon:${params.salonId}`).emit('inbox:conversations', conversations)
    } catch (err) {
      console.error('Socket emit error:', err)
    }
  },
}