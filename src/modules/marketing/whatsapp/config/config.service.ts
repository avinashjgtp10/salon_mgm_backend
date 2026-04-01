import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from './config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { SaveConfigBody, TestConnectionResult } from './config.types'

export const configService = {

  async getConfig(salonId: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) return null
    return {
      ...config,
      access_token: config.access_token.slice(0, 8) + '••••••••',
    }
  },

  async saveConfig(salonId: string, body: SaveConfigBody) {
    return configRepository.upsert(salonId, body)
  },

  async testConnection(salonId: string): Promise<TestConnectionResult> {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')

    const d = await whatsappMetaApi.testConnection(config.phone_number_id, config.access_token)

    await configRepository.setVerified(
      salonId,
      d.display_phone_number,
      d.quality_rating     ?? 'GREEN',
      d.messaging_limit_tier ?? 1
    )

    return {
      success:       true,
      tier:          String(d.messaging_limit_tier ?? 1),
      qualityRating: d.quality_rating ?? 'GREEN',
    }
  },
}
