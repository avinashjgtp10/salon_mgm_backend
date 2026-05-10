import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from './config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { SaveConfigBody, TestConnectionResult } from './config.types'
import logger from '../../../../config/logger'

const WEBHOOK_CALLBACK_URL =
  process.env.WEBHOOK_CALLBACK_URL ??
  `${process.env.APP_URL ?? 'https://your-app.onrender.com'}/api/v1/webhooks`

export const configService = {

  async getConfig(salonId: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) return null
    return {
      ...config,
      // Never send secrets to frontend
      access_token: config.access_token
        ? config.access_token.slice(0, 8) + '••••••••'
        : null,
      app_secret: config.app_secret ? '••••••••' : null,
    }
  },

  async saveConfig(salonId: string, body: SaveConfigBody) {
    const cleanBody: SaveConfigBody = {
      phone_number_id:      body.phone_number_id,
      waba_id:              body.waba_id,
      app_id:               body.app_id               || null,
      app_secret:           body.app_secret            || null,
      access_token:         body.access_token?.trim()  || null,
      webhook_verify_token: body.webhook_verify_token,
      display_phone:        body.display_phone          ?? null,
    }

    const saved = await configRepository.upsert(salonId, cleanBody as any)

    // ── Auto-register webhook with Meta ──────────────────────────────────────
    // Uses app_id + app_secret to generate an app access token (app_id|app_secret)
    // which has the correct permissions to register webhook subscriptions.
    const fullConfig = await configRepository.findBySalonId(salonId)

    if (
      fullConfig?.app_id &&
      fullConfig?.app_secret &&
      fullConfig?.access_token &&
      fullConfig?.webhook_verify_token
    ) {
      try {
        // App access token = app_id|app_secret (Meta format)
        const appAccessToken = `${fullConfig.app_id}|${fullConfig.app_secret}`

        // Step 1: Register webhook callback URL on the Meta App
        await whatsappMetaApi.registerWebhook({
          appId:        fullConfig.app_id,
          appToken:     appAccessToken,
          callbackUrl:  WEBHOOK_CALLBACK_URL,
          verifyToken:  fullConfig.webhook_verify_token,
        })

        // Step 2: Subscribe the WABA to receive webhook events
        await whatsappMetaApi.subscribeWaba({
          wabaId:      fullConfig.waba_id,
          accessToken: fullConfig.access_token,
        })

        logger.info(`✅ Webhook auto-registered for salon ${salonId}`)
      } catch (err: any) {
        logger.warn(`⚠️  Webhook auto-registration failed for salon ${salonId}: ${err?.message}`, { response: err?.response?.data })
      }
    }

    return {
      ...saved,
      access_token: saved.access_token
        ? saved.access_token.slice(0, 8) + '••••••••'
        : null,
      app_secret: saved.app_secret ? '••••••••' : null,
    }
  },

  async testConnection(salonId: string): Promise<TestConnectionResult> {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')

    const d = await whatsappMetaApi.testConnection(config.phone_number_id, config.access_token)

    await configRepository.setVerified(
      salonId,
      d.display_phone_number,
      d.quality_rating       ?? 'GREEN',
      d.messaging_limit_tier ?? 1
    )

    return {
      success:       true,
      tier:          String(d.messaging_limit_tier ?? 1),
      qualityRating: d.quality_rating ?? 'GREEN',
    }
  },
}