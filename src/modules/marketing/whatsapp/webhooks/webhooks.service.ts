import { AppError } from '../../../../middleware/error.middleware'
import { webhooksRepository } from './webhooks.repository'
import { inboxService } from '../inbox/inbox.service'

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

    // ── Delivery status updates (existing) ──────────────────────
    if (value?.statuses?.length) {
      for (const status of value.statuses) {
        await this.processStatus(status)
      }
    }

    // ── Inbound customer replies (NEW) ───────────────────────────
    if (value?.messages?.length) {
      // Use salonId passed from the URL (already resolved by the controller)
      // This avoids ambiguity when multiple salons share the same phone number
      const resolvedSalonId = (body as any)._salonId ?? null
      const phoneNumberId   = value?.metadata?.phone_number_id

      // Fallback to DB lookup if no salonId in body
      const salonId = resolvedSalonId
        ?? (phoneNumberId ? await webhooksRepository.findSalonByPhoneNumberId(phoneNumberId) : null)

      console.log('📨 Inbound message — salonId:', salonId, '| phoneNumberId:', phoneNumberId)

      if (salonId) {
        for (const msg of value.messages) {
          await this.processInboundMessage(salonId, msg, value.contacts?.[0])
        }
      }
    }
  },

  async processInboundMessage(salonId: string, msg: any, contact: any) {
    // Only handle text messages for now
    if (msg.type !== 'text') return

    const phone = msg.from
    const wamid = msg.id
    const body  = msg.text?.body ?? ''
    const name  = contact?.profile?.name ?? null

    await inboxService.handleInboundMessage({ salonId, phone, name, body, wamid })
  },

  async processStatus(status: any) {
    const wamid = status.id
    if (!wamid) return

    const type      = status.status?.toUpperCase()
    const timestamp = new Date(parseInt(status.timestamp) * 1000)
    const errorCode = status.errors?.[0]?.code?.toString() ?? null
    const errorMsg  = status.errors?.[0]?.title            ?? null

    // 🔍 Temporary debug log — remove after diagnosing failures
    if (type === 'FAILED') {
      console.error('📛 Webhook FAILED payload:', JSON.stringify({
        wamid, errorCode, errorMsg,
        rawErrors: status.errors,
        fullStatus: status,
      }, null, 2))
    }

    const contact = await webhooksRepository.findContactByWamid(wamid)
    if (!contact) return

    if (type === 'DELIVERED') {
      await webhooksRepository.markDelivered(wamid, timestamp)
    } else if (type === 'READ') {
      await webhooksRepository.markRead(wamid, timestamp)
    } else if (type === 'FAILED') {
      const isBlocked = [131047, 131026, 131051].includes(parseInt(errorCode ?? '0'))
      await webhooksRepository.markFailed(
        wamid,
        isBlocked ? 'BLOCKED' : 'FAILED',
        errorCode,
        errorMsg
      )
    }

    await webhooksRepository.refreshCampaignCounts(contact.campaign_id)
  },

  async getRecentEvents(salonId: string, campaignId?: string) {
    return webhooksRepository.getRecentEvents(salonId, campaignId)
  },
}