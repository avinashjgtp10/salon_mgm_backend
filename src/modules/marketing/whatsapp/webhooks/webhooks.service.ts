import { AppError } from '../../../../middleware/error.middleware'
import { webhooksRepository } from './webhooks.repository'
import { inboxService } from '../inbox/inbox.service'
import { flowsService } from '../flows/flows.service'
import { inboxRepository } from '../inbox/inbox.repository'
import { whatsappAutomationService } from '../../../whatsapp-automation/whatsapp-automation.service'
import { notificationsService } from '../../../notifications/notifications.service'
import pool from '../../../../config/database'
import logger from '../../../../config/logger'

export const webhooksService = {

  // ── Global verify — looks up salon by verify token ────────────────────────
  // Used by GET /api/v1/webhooks/whatsapp (what you paste in Meta App Dashboard)
  async verifyGlobal(mode: string, token: string, challenge: string) {
    if (mode !== 'subscribe') {
      throw new AppError(403, 'Invalid hub.mode', 'WEBHOOK_VERIFY_FAILED')
    }
    if (!token) {
      throw new AppError(403, 'Missing verify token', 'WEBHOOK_VERIFY_FAILED')
    }

    // Find which salon has this verify token. TRIM both sides so a token that
    // was saved with incidental whitespace (pre-trim-fix rows) still matches
    // the clean value Meta sends back — otherwise verification silently 403s.
    const { rows } = await pool.query(
      `SELECT salon_id FROM whatsapp_configs WHERE TRIM(webhook_verify_token) = TRIM($1) LIMIT 1`,
      [token]
    )

    if (!rows[0]) {
      logger.warn(`⚠️ Global webhook verify failed — token not found: ${token}`)
      throw new AppError(403, 'Webhook verification failed — token not found', 'WEBHOOK_VERIFY_FAILED')
    }

    logger.info(`✅ Global webhook verified for salon ${rows[0].salon_id}`)
    return challenge
  },

  // ── Per-salon verify — backward compat ────────────────────────────────────
  async verify(salonId: string, mode: string, token: string, challenge: string) {
    const verifyToken = await webhooksRepository.findVerifyToken(salonId)
    if (!verifyToken) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')
    if (mode === 'subscribe' && token.trim() === verifyToken.trim()) return challenge
    throw new AppError(403, 'Webhook verification failed', 'WEBHOOK_VERIFY_FAILED')
  },

  async handleWebhook(body: any) {
    const entry   = body?.entry?.[0]
    const changes = entry?.changes?.[0]
    const value   = changes?.value
    const field   = changes?.field

    if (field === 'business_capability_update') {
      await this.processCapabilityUpdate(value)
      return
    }

    if (field === 'phone_number_quality_update') {
      await this.processQualityUpdate(value)
      return
    }

    if (value?.statuses?.length) {
      for (const status of value.statuses) {
        await this.processStatus(status)
      }
    }

    if (value?.messages?.length) {
      const resolvedSalonId = (body as any)._salonId ?? null
      const phoneNumberId   = value?.metadata?.phone_number_id
      const salonId = resolvedSalonId
        ?? (phoneNumberId ? await webhooksRepository.findSalonByPhoneNumberId(phoneNumberId) : null)
      if (salonId) {
        for (const msg of value.messages) {
          await this.processInboundMessage(salonId, msg, value.contacts?.[0])
        }
      }
    }
  },

  async processCapabilityUpdate(value: any) {
    try {
      logger.info('📊 business_capability_update received:', { value })
      const newLimit      = value?.max_daily_conversations_per_business
                         ?? value?.max_daily_conversation_per_phone
      const phoneNumberId = value?.phone_number_id ?? value?.phone_number
      if (!phoneNumberId || !newLimit) return
      const dailyLimit = Number(newLimit)
      if (isNaN(dailyLimit) || dailyLimit <= 0) return
      const { rows } = await pool.query(
        `SELECT salon_id FROM whatsapp_configs WHERE phone_number_id = $1`,
        [String(phoneNumberId)]
      )
      if (!rows[0]) return
      await pool.query(
        `UPDATE whatsapp_configs SET daily_limit = $1, updated_at = NOW() WHERE salon_id = $2`,
        [dailyLimit, rows[0].salon_id]
      )
      logger.info(`✅ Auto-updated daily_limit to ${dailyLimit} for salon ${rows[0].salon_id}`)
    } catch (err: any) {
      logger.error('❌ processCapabilityUpdate failed:', { error: err?.message })
    }
  },

  async processQualityUpdate(value: any) {
    try {
      logger.info('📊 phone_number_quality_update received:', { value })
      const phoneNumberId = value?.phone_number
      const currentLimit  = value?.current_limit
      const qualityRating = value?.quality_rating ?? value?.quality_score ?? 'GREEN'
      if (!phoneNumberId) return
      const TIER_MAP: Record<string, number> = {
        TIER_50: 50, TIER_250: 250, TIER_1K: 1000,
        TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000,
      }
      const dailyLimit = TIER_MAP[currentLimit] ?? null
      const { rows } = await pool.query(
        `SELECT salon_id FROM whatsapp_configs WHERE phone_number_id = $1`,
        [String(phoneNumberId)]
      )
      if (!rows[0]) return
      if (dailyLimit !== null) {
        await pool.query(
          `UPDATE whatsapp_configs SET quality_rating = $1, daily_limit = $2, updated_at = NOW() WHERE salon_id = $3`,
          [qualityRating, dailyLimit, rows[0].salon_id]
        )
        logger.info(`✅ Auto-updated limit to ${dailyLimit} for salon ${rows[0].salon_id}`)
      } else {
        await pool.query(
          `UPDATE whatsapp_configs SET quality_rating = $1, updated_at = NOW() WHERE salon_id = $2`,
          [qualityRating, rows[0].salon_id]
        )
      }
    } catch (err: any) {
      logger.error('❌ processQualityUpdate failed:', { error: err?.message })
    }
  },

  async processInboundMessage(salonId: string, msg: any, contact: any) {
    const senderName = contact?.profile?.name ?? msg.from

    // Booking form submitted - handled end to end (thread line, enquiry,
    // notification, confirmation) by the flows service.
    if (msg.type === 'interactive' && msg.interactive?.type === 'nfm_reply') {
      await flowsService.handleBookingResponse(
        salonId, msg.from, contact?.profile?.name ?? null, msg.id,
        msg.interactive.nfm_reply?.response_json ?? '{}'
      )
      return
    }

    // The customer reacted to one of our messages with an emoji (or removed it).
    if (msg.type === 'reaction') {
      await inboxService.handleInboundReaction(salonId, msg.reaction?.message_id ?? '', msg.reaction?.emoji ?? '')
      return
    }

    // Everything else a customer can send. Previously only plain text was kept,
    // so template quick-reply taps, list/button replies and photos vanished.
    let messageBody = ''
    let mediaType: 'image' | 'video' | 'audio' | 'document' | null = null
    let mediaId: string | null = null
    switch (msg.type) {
      case 'text':        messageBody = msg.text?.body ?? ''; break
      case 'button':      messageBody = msg.button?.text ?? ''; break
      case 'interactive':
        messageBody = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? ''
        break
      case 'image':
      case 'video':
      case 'document':
        mediaType   = msg.type
        mediaId     = msg[msg.type]?.id ?? null
        messageBody = msg[msg.type]?.caption ?? ''
        break
      case 'audio':
        mediaType   = 'audio'
        mediaId     = msg.audio?.id ?? null
        messageBody = '🎤 Voice message'
        break
      case 'sticker':     messageBody = '🙂 Sticker'; break
      case 'location':    messageBody = '📍 Location shared'; break
      case 'contacts':    messageBody = '👤 Contact shared'; break
      default:            return   // reactions, system messages, unsupported - ignore as before
    }
    if (!messageBody && !mediaId) return

    // Read BEFORE this message is stored: tells the auto-send rule below whether
    // this reply re-opens a closed 24h window.
    const prevInboundAt = await flowsService.getLastInboundAt(salonId, msg.from).catch(() => null)

    await inboxService.handleInboundMessage({
      salonId,
      phone: msg.from,
      name:  senderName,
      body:  messageBody,
      wamid: msg.id,
      mediaType,
      mediaUrl: mediaId,
    })

    // Fire notification for incoming WhatsApp message (fire-and-forget)
    notificationsService.create({
      salon_id: salonId,
      type:     'whatsapp',
      title:    `WhatsApp: ${senderName}`,
      body:     messageBody.length > 80 ? messageBody.slice(0, 77) + '…' : messageBody,
      event_key: 'newMessage',
      contact_phone: msg.from,
    }).catch((err: any) => {
      logger.error('WhatsApp inbound notification failed', {
        salonId,
        phone: msg.from,
        message: err?.message,
        stack: err?.stack,
        error: err,
      })
    })

    // Auto-send the booking form on a window-reopening reply (if the salon
    // enabled it).
    flowsService.autoSendOnReply(salonId, msg.from, prevInboundAt).catch((err: any) =>
      logger.warn('Booking form auto-send failed', { salonId, message: err?.message })
    )
  },

  async processStatus(status: any) {
    const wamid = status.id
    if (!wamid) return

    const type      = status.status?.toUpperCase()
    const timestamp = new Date(parseInt(status.timestamp) * 1000)
    const errorCode = status.errors?.[0]?.code?.toString() ?? null
    const errTitle   = status.errors?.[0]?.title ?? status.errors?.[0]?.message ?? null
    const errDetails = status.errors?.[0]?.error_data?.details ?? null
    const errorMsg   = errTitle && errDetails && errDetails !== errTitle ? `${errTitle} — ${errDetails}` : (errTitle ?? errDetails)

    // Logged for every status, not just FAILED — a SENT/DELIVERED/READ update
    // previously left no trace at all, so there was no way to tell "webhook
    // never arrived" apart from "webhook arrived but was a status we don't
    // specially log".
    logger.info(`📶 [WEBHOOK] status=${type} wamid=${wamid}`, { errorCode, errorMsg })

    if (type === 'FAILED') {
      logger.error('📛 Webhook FAILED payload:', {
        wamid, errorCode, errorMsg,
        rawErrors: status.errors,
        fullStatus: status,
      })
    }

    // ── One-to-one Inbox messages: persist the receipt so the thread can show
    // delivered / read / failed. (Previously only campaign contacts and
    // automation logs were updated, so an undeliverable Inbox message sat at a
    // single tick forever.) Best-effort - never blocks the existing handling.
    if (type === 'SENT' || type === 'DELIVERED' || type === 'READ' || type === 'FAILED') {
      inboxRepository.applyDeliveryStatus(wamid, type, timestamp).catch((err: any) =>
        logger.warn('Inbox delivery status update failed', { wamid, message: err?.message })
      )
    }

    // ── Check campaign contacts first (existing behaviour) ────────────────────
    const contact = await webhooksRepository.findContactByWamid(wamid)

    if (!contact) {
      // ── WA-AUTO: Fallback — check if wamid belongs to automation logs ───────
      // Validate untrusted webhook fields before delegating
      const allowedTypes = ['SENT', 'DELIVERED', 'READ', 'FAILED']
      if (
        typeof wamid === 'string' && wamid.length > 0 &&
        typeof type  === 'string' && allowedTypes.includes(type) &&
        timestamp instanceof Date && !isNaN(timestamp.getTime())
      ) {
        try {
          const matched = await whatsappAutomationService.handleDeliveryStatus(wamid, type, timestamp)
          logger.info(`[WA-AUTO] handleDeliveryStatus ${matched ? 'matched a log row' : 'found NO matching log row'} for wamid=${wamid}`)
        } catch (err: any) {
          logger.warn('[WA-AUTO] handleDeliveryStatus error:', err?.message)
        }
      } else {
        logger.warn('[WA-AUTO] Skipping automation delivery update — invalid webhook fields', { wamid, type, timestamp })
      }
      return
    }

    // ── Campaign delivery tracking (unchanged) ────────────────────────────────
    if (type === 'DELIVERED') {
      await webhooksRepository.markDelivered(wamid, timestamp)
    } else if (type === 'READ') {
      await webhooksRepository.markRead(wamid, timestamp)
    } else if (type === 'FAILED') {
      // 131042 = account-level billing/eligibility block (no payment method on
      // the WABA) — same "not this recipient's fault" bucket as the other
      // codes here, kept in sync with campaign.processor.ts's send-time check.
      const isBlocked = [131047, 131026, 131051, 131049, 131042].includes(parseInt(errorCode ?? '0'))
      await webhooksRepository.markFailed(wamid, isBlocked ? 'BLOCKED' : 'FAILED', errorCode, errorMsg)
    }

    await webhooksRepository.refreshCampaignCounts(contact.campaign_id)
  },
}
