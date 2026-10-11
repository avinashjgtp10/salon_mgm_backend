import { AppError } from '../../../../middleware/error.middleware'
import { inboxRepository } from './inbox.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { configRepository } from '../config/config.repository'
import { templatesRepository } from '../templates/templates.repository'
import { buildOfferComponents } from '../shared/offer-components'
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

  async getUnreadTotal(salonId: string) {
    return inboxRepository.getUnreadTotal(salonId)
  },

  async getMessages(salonId: string, phone: string) {
    const normalizedPhone = normalizePhone(phone)
    // Fire-and-forget — don't block message fetch on unread reset
    inboxRepository.markConversationRead(salonId, normalizedPhone).catch(() => {})
    // …and tell WhatsApp too, so the customer sees blue ticks. Best-effort only.
    inboxService.markReadOnWhatsApp(salonId, normalizedPhone, false).catch(() => {})
    return inboxRepository.getMessages(salonId, normalizedPhone)
  },

  // Read receipt (+ optional typing indicator) for the customer's newest message.
  // Never throws into the caller: a failure here (window long closed, message
  // too old for Meta, WhatsApp disconnected) must not break opening a chat.
  async markReadOnWhatsApp(salonId: string, phone: string, typing: boolean) {
    const normalizedPhone = normalizePhone(phone)
    const latest = await inboxRepository.getLatestInbound(salonId, normalizedPhone)
    if (!latest) return { ok: false }
    // Already confirmed read earlier → skip, unless we also want the typing dots.
    if (!typing && latest.status === 'READ') return { ok: true, skipped: true }
    const config = await configRepository.findBySalonId(salonId)
    if (!config) return { ok: false }
    try {
      await whatsappMetaApi.markAsRead({
        phoneNumberId: config.phone_number_id,
        accessToken:   config.access_token,
        messageId:     latest.wamid,
        typing,
      })
      await inboxRepository.updateMessageStatus(latest.wamid, 'READ', 'read_at', new Date())
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },

  // ── Customer Info panel — null when the number doesn't match a saved
  // client (e.g. a lead who messaged in but was never added as a client).
  async getCustomerInfo(salonId: string, phone: string) {
    return inboxRepository.findCustomerInfoByPhone(salonId, phone)
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

  // Sends one approved template to a single contact from the Inbox. Mirrors the
  // campaign worker's component building so a template behaves identically
  // whether blasted or sent one-to-one.
  async sendTemplate(
    salonId: string, phone: string, templateId: string, variables: Record<string, string>,
    offer?: { couponCode?: string; expiresAt?: string }
  ) {
    const normalizedPhone = normalizePhone(phone)

    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    const template = await templatesRepository.findById(templateId, salonId)
    if (!template) throw new AppError(404, 'Template not found', 'TEMPLATE_NOT_FOUND')
    if (template.status !== 'APPROVED') {
      throw new AppError(400, 'Only Meta-approved templates can be sent', 'TEMPLATE_NOT_APPROVED')
    }

    const bodyText = template.body_text ?? ''
    const slots    = bodyText.match(/\{\{(\d+)\}\}/g) ?? []
    const hasMediaHeader = !!template.header_type && template.header_type !== 'none' && template.header_type !== 'text'
    if (hasMediaHeader && !template.header_media_id) {
      throw new AppError(400, 'Template has a media header but no media is stored — re-create it with a file upload', 'MISSING_MEDIA_ID')
    }

    const components: any[] = []
    if (hasMediaHeader) {
      const mt = template.header_type as string
      components.push({ type: 'header', parameters: [{ type: mt, [mt]: { id: template.header_media_id } }] })
    }

    // Body slots are positional; a blank value would be rejected by Meta, so
    // fail early with a clear message instead.
    const slotNumbers = Array.from(new Set(slots.map(s => parseInt(s.replace(/[{}]/g, ''), 10)))).sort((a, b) => a - b)
    const values: Record<number, string> = {}
    for (const n of slotNumbers) {
      const v = (variables[String(n)] ?? '').trim()
      if (!v) throw new AppError(400, `Please fill in value for {{${n}}}`, 'TEMPLATE_VARIABLE_MISSING')
      values[n] = v
    }
    if (slots.length > 0) {
      const params = slots.map(s => ({ type: 'text', text: values[parseInt(s.replace(/[{}]/g, ''), 10)] }))
      components.push({ type: 'body', parameters: params })
    }

    // Offer templates (expiry countdown / copy-code button)
    try {
      const { afterBody } = buildOfferComponents(
        { buttons: template.buttons as any, lto_text: (template as any).lto_text, carousel: (template as any).carousel },
        { couponCode: offer?.couponCode, expiresAt: offer?.expiresAt, flowToken: `${salonId}:${Date.now()}` }
      )
      components.push(...afterBody)
    } catch (e: any) {
      throw new AppError(400, e.message, 'TEMPLATE_OFFER_MISSING')
    }

    const result = await whatsappMetaApi.sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken:   config.access_token,
      to:            normalizedPhone,
      templateName:  template.name,
      language:      template.language,
      components,
    })
    const wamid = result?.messages?.[0]?.id ?? null

    // What the thread shows: the template wording with the real values filled in.
    const renderedBody = bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => values[parseInt(n, 10)] ?? '')
    const mediaLabel =
      template.header_type === 'image'    ? '🖼 [Image]'    :
      template.header_type === 'video'    ? '🎬 [Video]'    :
      template.header_type === 'document' ? '📄 [Document]' : ''
    const preview = mediaLabel ? mediaLabel + (renderedBody ? ' ' + renderedBody.slice(0, 60) : '') : renderedBody

    const conversationId = await inboxRepository.upsertConversation(
      salonId, normalizedPhone, null, preview, false
    )

    return inboxRepository.insertMessage({
      conversationId,
      salonId,
      direction: 'OUTBOUND',
      body:      renderedBody,
      wamid,
      status:    'SENT',
      mediaType: hasMediaHeader ? (template.header_type as any) : null,
      mediaUrl:  hasMediaHeader ? template.header_media_id ?? null : null,
    })
  },

  // Bytes for a media id shown in the thread (a template's image header, or a
  // file the customer sent) — pulled from Meta with this salon's own token, so a
  // media id belonging to another salon's number simply fails to resolve.
  async getMedia(salonId: string, mediaId: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(404, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')
    try {
      return await whatsappMetaApi.downloadMedia(config.access_token, mediaId)
    } catch {
      throw new AppError(404, 'Media is no longer available', 'MEDIA_NOT_FOUND')
    }
  },

  // Free-form messages (text, media, reactions) are only deliverable inside the
  // 24h window - refuse early with a clear reason instead of a "Not delivered".
  async assertWindowOpen(salonId: string, phone: string) {
    const last = await inboxRepository.getLastInboundAt(salonId, normalizePhone(phone))
    if (!last || Date.now() - last.getTime() > 24 * 3600 * 1000) {
      throw new AppError(
        400,
        'This customer has not messaged you in the last 24 hours, so WhatsApp will only deliver an approved template. Use the template button instead.',
        'WINDOW_CLOSED'
      )
    }
  },

  // Sends a photo / video / audio file / document from the Inbox. WhatsApp's own
  // limits apply: images are JPEG or PNG up to 5 MB, video MP4 or 3GP up to 16 MB,
  // audio up to 16 MB (AAC, MP3, MP4, AMR or OGG-Opus), documents up to 100 MB
  // (this endpoint caps uploads at 16 MB).
  async sendMedia(salonId: string, phone: string, file: Express.Multer.File, caption?: string) {
    const normalizedPhone = normalizePhone(phone)
    await this.assertWindowOpen(salonId, normalizedPhone)

    const mime = (file.mimetype || '').toLowerCase()
    let type: 'image' | 'video' | 'audio' | 'document'
    if (mime === 'image/jpeg' || mime === 'image/png') type = 'image'
    else if (mime.startsWith('image/')) throw new AppError(400, 'Only JPEG and PNG photos can be sent', 'UNSUPPORTED_MEDIA')
    else if (mime === 'video/mp4' || mime === 'video/3gpp') type = 'video'
    else if (mime.startsWith('video/')) throw new AppError(400, 'Only MP4 or 3GP video can be sent', 'UNSUPPORTED_MEDIA')
    else if (/^audio\/(aac|mp4|mpeg|amr|ogg)/.test(mime)) type = 'audio'
    else if (mime.startsWith('audio/')) throw new AppError(400, 'Audio must be AAC, MP3, MP4, AMR or OGG (Opus)', 'UNSUPPORTED_MEDIA')
    else type = 'document'

    const maxMb = type === 'image' ? 5 : 16
    if (file.size > maxMb * 1024 * 1024) throw new AppError(400, `File is too large — max ${maxMb} MB for ${type === 'document' ? 'this upload' : type + 's'}`, 'FILE_TOO_LARGE')

    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')

    let mediaId: string, result: any
    try {
      mediaId = await whatsappMetaApi.uploadMedia({
        phoneNumberId: config.phone_number_id, accessToken: config.access_token,
        buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype,
      })
      result = await whatsappMetaApi.sendMediaMessage({
        phoneNumberId: config.phone_number_id, accessToken: config.access_token,
        to: normalizedPhone, type, mediaId, caption: caption?.trim() || undefined, filename: file.originalname,
      })
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err.message
      throw new AppError(400, `Could not send the file: ${msg}`, 'MEDIA_SEND_FAILED')
    }

    const label = type === 'image' ? '📷 Photo' : type === 'video' ? '🎬 Video' : type === 'audio' ? '🎤 Audio' : `📄 ${file.originalname}`
    const body = caption?.trim() ? caption.trim() : label
    const conversationId = await inboxRepository.upsertConversation(salonId, normalizedPhone, null, caption?.trim() ? `${label} ${caption.trim()}`.slice(0, 80) : label, false)
    return inboxRepository.insertMessage({
      conversationId, salonId, direction: 'OUTBOUND', body,
      wamid: result?.messages?.[0]?.id ?? null, status: 'SENT',
      mediaType: type, mediaUrl: mediaId,
    })
  },

  // Our reaction to a message in the thread - sent to the customer's WhatsApp and
  // remembered. emoji '' removes it.
  async reactToMessage(salonId: string, messageId: string, emoji: string) {
    const msg = await inboxRepository.findMessageForReaction(salonId, messageId)
    if (!msg) throw new AppError(404, 'Message not found', 'NOT_FOUND')
    if (!msg.wamid) throw new AppError(400, 'This message cannot be reacted to', 'NO_WAMID')
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')
    try {
      await whatsappMetaApi.sendReaction({
        phoneNumberId: config.phone_number_id, accessToken: config.access_token,
        to: msg.contact_phone, messageId: msg.wamid, emoji,
      })
    } catch (err: any) {
      const code = err?.response?.data?.error?.code
      if (code === 131047) throw new AppError(400, 'The 24-hour window is closed, so a reaction cannot be sent', 'WINDOW_CLOSED')
      throw new AppError(400, `Could not send the reaction: ${err?.response?.data?.error?.message ?? err.message}`, 'REACTION_FAILED')
    }
    await inboxRepository.setReaction({ id: messageId }, emoji)
    return { id: messageId, reaction: emoji || null }
  },

  // The customer reacted to one of our messages (webhook type "reaction").
  async handleInboundReaction(salonId: string, targetWamid: string, emoji: string) {
    if (!targetWamid) return
    const row = await inboxRepository.setReaction({ wamid: targetWamid }, emoji)
    try {
      const io = getIO()
      io.to(`salon:${salonId}`).emit('inbox:reaction', { salonId, contactPhone: row?.contact_phone ?? null, wamid: targetWamid, emoji: emoji || null })
    } catch { /* live push is best-effort */ }
  },

  async handleInboundMessage(params: {
    salonId: string
    phone:   string
    name:    string | null
    body:    string
    wamid:   string
    // Set when the customer sent an image/video/document - the Meta media id.
    mediaType?: 'image' | 'video' | 'audio' | 'document' | null
    mediaUrl?:  string | null
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
      mediaType: params.mediaType ?? null,
      mediaUrl:  params.mediaUrl ?? null,
    })

    try {
      const io = getIO()
      const room = `salon:${params.salonId}`
      io.to(room).emit('inbox:message', {
        salonId:      params.salonId,
        contactPhone: normalizedPhone,
        contactName:  params.name,
        message,
      })
      const conversations = await inboxRepository.getConversations(params.salonId)
      io.to(room).emit('inbox:conversations', conversations)
    } catch (err) {
      console.error('Socket emit error:', err)
    }
  },
}