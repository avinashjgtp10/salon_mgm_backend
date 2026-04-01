import { AppError } from '../../../../middleware/error.middleware'
import { webhooksRepository } from './webhooks.repository'

export const webhooksService = {

  async verify(salonId: string, mode: string, token: string, challenge: string) {
    const verifyToken = await webhooksRepository.findVerifyToken(salonId)
    if (!verifyToken) throw new AppError(400, 'WhatsApp not configured', 'WA_NOT_CONFIGURED')
    if (mode === 'subscribe' && token === verifyToken) return challenge
    throw new AppError(403, 'Webhook verification failed', 'WEBHOOK_VERIFY_FAILED')
  },

  async handleWebhook(body: any) {
    const entry    = body?.entry?.[0]
    const changes  = entry?.changes?.[0]
    const value    = changes?.value
    const statuses = value?.statuses

    if (statuses?.length) {
      for (const status of statuses) {
        await this.processStatus(status)
      }
    }
  },

  async processStatus(status: any) {
    const wamid = status.id
    if (!wamid) return

    const type      = status.status?.toUpperCase()
    const timestamp = new Date(parseInt(status.timestamp) * 1000)
    const errorCode = status.errors?.[0]?.code?.toString() ?? null
    const errorMsg  = status.errors?.[0]?.title            ?? null

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
