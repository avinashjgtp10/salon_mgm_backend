import { AppError } from '../../../../middleware/error.middleware'
import { webhooksRepository } from './webhooks.repository'
import { inboxService } from '../inbox/inbox.service'
import { whatsappAutomationService } from '../../../whatsapp-automation/whatsapp-automation.service'
import pool from '../../../../config/database'
import logger from '../../../../config/logger'

export const webhooksService = {

  async verify(salonId: string, mode: string, token: string, challenge: string) {
    const verifyToken = await webhooksRepository.findVerifyToken(salonId)
    if (!verifyToken) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')
    if (mode === 'subscribe' && token === verifyToken) return challenge
    throw new AppError(403, 'Webhook verification failed', 'WEBHOOK_VERIFY_FAILED')
  },

  async handleWebhook(body: any) {
    const entry   = body?.entry?.[0]
    const changes = entry?.changes?.[0]
    const value   = changes?.value
    const field   = changes?.field

    // ── Portfolio limit auto-update (new Meta webhook Oct 2025) ──────────────
    if (field === 'business_capability_update') {
      await this.processCapabilityUpdate(value)
      return
    }

    // ── Legacy quality update webhook ─────────────────────────────────────────
    if (field === 'phone_number_quality_update') {
      await this.processQualityUpdate(value)
      return
    }

    // ── Delivery status updates ───────────────────────────────────────────────
    if (value?.statuses?.length) {
      for (const status of value.statuses) {
        await this.processStatus(status)
      }
    }

    // ── Inbound customer replies ──────────────────────────────────────────────
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

  // ── NEW: business_capability_update — fires when portfolio limit changes ───
  async processCapabilityUpdate(value: any) {
    try {
      logger.info('📊 business_capability_update received:', { value })

      const newLimit = value?.max_daily_conversations_per_business
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
      logger.info(`✅ Auto-updated daily_limit to ${dailyLimit} via business_capability_update for salon ${rows[0].salon_id}`)
    } catch (err: any) {
      logger.error('❌ processCapabilityUpdate failed:', { error: err?.message })
    }
  },

  // ── LEGACY: phone_number_quality_update ───────────────────────────────────
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
    if (msg.type !== 'text') return
    await inboxService.handleInboundMessage({
      salonId,
      phone: msg.from,
      name:  contact?.profile?.name ?? null,
      body:  msg.text?.body ?? '',
      wamid: msg.id,
    })
  },

  async processStatus(status: any) {
    const wamid = status.id
    if (!wamid) return

    const type      = status.status?.toUpperCase()
    const timestamp = new Date(parseInt(status.timestamp) * 1000)
    const errorCode = status.errors?.[0]?.code?.toString() ?? null
    const errorMsg  = status.errors?.[0]?.title            ?? null

    if (type === 'FAILED') {
      console.error('📛 Webhook FAILED payload:', JSON.stringify({
        wamid, errorCode, errorMsg, rawErrors: status.errors, fullStatus: status,
      }, null, 2))
    }

    // ── Check campaign contacts first (existing behaviour) ────────────────────
    const contact = await webhooksRepository.findContactByWamid(wamid)

    if (!contact) {
      // ── WA-AUTO: Fallback — check if wamid belongs to automation logs ───────
      // This handles delivery receipts for event-triggered messages (not campaigns)
      await whatsappAutomationService.handleDeliveryStatus(wamid, type, timestamp)
      return
    }

    // ── Campaign delivery tracking (unchanged) ────────────────────────────────
    if (type === 'DELIVERED') {
      await webhooksRepository.markDelivered(wamid, timestamp)
    } else if (type === 'READ') {
      await webhooksRepository.markRead(wamid, timestamp)
    } else if (type === 'FAILED') {
      const isBlocked = [131047, 131026, 131051].includes(parseInt(errorCode ?? '0'))
      await webhooksRepository.markFailed(wamid, isBlocked ? 'BLOCKED' : 'FAILED', errorCode, errorMsg)
    }

    await webhooksRepository.refreshCampaignCounts(contact.campaign_id)
  },

  async getRecentEvents(salonId: string, campaignId?: string) {
    return webhooksRepository.getRecentEvents(salonId, campaignId)
  },
}