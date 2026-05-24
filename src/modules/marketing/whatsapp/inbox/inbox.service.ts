import { AppError } from '../../../../middleware/error.middleware'
import { inboxRepository } from './inbox.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { configRepository } from '../config/config.repository'
import { getIO } from '../../../../config/socket'


function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('+'))                          return '+' + digits
  if (digits.length === 10)                           return '+91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  return '+' + digits
}

export const inboxService = {

  async getConversations(salonId: string) {
    return inboxRepository.getConversations(salonId)
  },

  async getMessages(salonId: string, phone: string) {
    const normalizedPhone = normalizePhone(phone)
    // Fire-and-forget — don't block message fetch on unread reset
    inboxRepository.markConversationRead(salonId, normalizedPhone).catch(() => {})
    return inboxRepository.getMessages(salonId, normalizedPhone)
  },

  async sendReply(salonId: string, phone: string, message: string) {
    const normalizedPhone = normalizePhone(phone)

    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    const result = await whatsappMetaApi.sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken:   config.access_token,
      to:            normalizedPhone,
      message,
    })

    const wamid = result.messages?.[0]?.id ?? null

    const conversationId = await inboxRepository.upsertConversation(
      salonId, normalizedPhone, null, message, false
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
    const normalizedPhone = normalizePhone(params.phone)

    const conversationId = await inboxRepository.upsertConversation(
      params.salonId, normalizedPhone, params.name, params.body, true
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
        contactPhone: normalizedPhone,
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