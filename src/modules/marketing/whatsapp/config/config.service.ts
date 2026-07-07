import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from './config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { SaveConfigBody, TestConnectionResult } from './config.types'
import logger from '../../../../config/logger'

// APP_URL = your backend domain e.g. https://api.salonox.com
// Each salon gets their own webhook URL with their salonId in it
function getWebhookUrl(salonId: string): string {
  const base = process.env.APP_URL ?? 'https://your-app.onrender.com'
  return `${base}/api/v1/webhooks/${salonId}/meta`
}

export const configService = {

  async getConfig(salonId: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) return null
    return {
      ...config,
      access_token: config.access_token
        ? config.access_token.slice(0, 8) + '••••••••'
        : null,
      app_secret: config.app_secret ? '••••••••' : null,
    }
  },

  async setAiReceptionistEnabled(salonId: string, enabled: boolean) {
    const updated = await configRepository.setAiReceptionistEnabled(salonId, enabled)
    if (!updated) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')
    return { ai_receptionist_enabled: updated.ai_receptionist_enabled }
  },

  async saveConfig(salonId: string, body: SaveConfigBody) {

    // ── Check verify token uniqueness ─────────────────────────────────────────
    if (body.webhook_verify_token) {
      const taken = await configRepository.isVerifyTokenTaken(
        body.webhook_verify_token,
        salonId
      )
      if (taken) {
        throw new AppError(
          409,
          'This Webhook Verify Token is already in use by another account. Please choose a unique token — e.g. webhook_verify_yourSalonName',
          'VERIFY_TOKEN_TAKEN'
        )
      }
    }

    const cleanBody: SaveConfigBody = {
      phone_number_id:      body.phone_number_id,
      waba_id:              body.waba_id,
      app_id:               body.app_id               || null,
      app_secret:           body.app_secret            || null,
      access_token:         body.access_token?.trim()  || null,
      webhook_verify_token: body.webhook_verify_token,
      display_phone:        body.display_phone         ?? null,
    }

    let saved: Awaited<ReturnType<typeof configRepository.upsert>>
    try {
      saved = await configRepository.upsert(salonId, cleanBody as any)
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new AppError(
          409,
          'This Phone Number ID is already registered to another account. Each salon must use their own WhatsApp number.',
          'PHONE_NUMBER_ID_TAKEN'
        )
      }
      throw err
    }

    // ── Auto-register webhook with Meta ───────────────────────────────────────
    // Re-fetch so we have the full config including any previously saved secrets
    const fullConfig = await configRepository.findBySalonId(salonId)

    if (
      fullConfig?.app_id &&
      fullConfig?.app_secret &&
      fullConfig?.access_token &&
      fullConfig?.webhook_verify_token
    ) {
      try {
        const appAccessToken = `${fullConfig.app_id}|${fullConfig.app_secret}`

        // Each salon gets their own webhook URL with salonId in it
        const callbackUrl = getWebhookUrl(salonId)

        await whatsappMetaApi.registerWebhook({
          appId:       fullConfig.app_id,
          appToken:    appAccessToken,
          callbackUrl, // ← correct URL with salonId
          verifyToken: fullConfig.webhook_verify_token,
        })

        await whatsappMetaApi.subscribeWaba({
          wabaId:      fullConfig.waba_id,
          accessToken: fullConfig.access_token,
        })

        logger.info(`✅ Webhook registered: ${callbackUrl} for salon ${salonId}`)
      } catch (err: any) {
        logger.warn(
          `⚠️  Webhook auto-registration failed for salon ${salonId}: ${err?.message}`,
          { response: err?.response?.data }
        )
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

  // ── Disconnect — removes this salon's WhatsApp connection ─────────────────
  // Templates, campaigns and message history are untouched; only the
  // credentials/config row is deleted so the salon can reconnect fresh.
  async deleteConfig(salonId: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(404, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')

    if (config.waba_id && config.access_token) {
      try {
        await whatsappMetaApi.unsubscribeWaba({ wabaId: config.waba_id, accessToken: config.access_token })
      } catch (err: any) {
        logger.warn(`⚠️  Failed to unsubscribe WABA for salon ${salonId} during disconnect: ${err?.message}`)
      }
    }

    await configRepository.delete(salonId)
  },

  // ── Refresh daily_limit + quality_rating from Meta ────────────────────────
  // Shared by the manual /sync-limits endpoint and the background scheduler.
  async syncLimitsForSalon(salonId: string) {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) return null

    const limits = await whatsappMetaApi.fetchPhoneNumberLimits(
      config.phone_number_id,
      config.access_token,
      config.waba_id
    )
    // fetchPhoneNumberLimits returns daily_limit: 0 when every Meta lookup
    // fails — don't let a transient failure wipe out a known-good limit
    const resolvedLimit = limits.daily_limit > 0 ? limits.daily_limit : config.daily_limit

    return configRepository.setVerified(
      salonId,
      config.display_phone ?? '',
      limits.quality_rating,
      resolvedLimit
    )
  },

  async testConnection(salonId: string): Promise<TestConnectionResult> {
    const config = await configRepository.findBySalonId(salonId)
    if (!config) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')

    const d = await whatsappMetaApi.testConnection(config.phone_number_id, config.access_token)

    // testConnection's own payload doesn't reliably carry the messaging limit
    // (Meta returns it as a tier code, not a plain field) — reuse the same
    // robust lookup that /sync-limits uses so we don't overwrite daily_limit
    // with a wrong value on every "Test Connection" click.
    const limits = await whatsappMetaApi.fetchPhoneNumberLimits(
      config.phone_number_id,
      config.access_token,
      config.waba_id
    )
    // fetchPhoneNumberLimits returns daily_limit: 0 when every Meta lookup
    // fails — don't let a transient failure wipe out a known-good limit
    const resolvedLimit = limits.daily_limit > 0 ? limits.daily_limit : config.daily_limit

    await configRepository.setVerified(
      salonId,
      d.display_phone_number,
      d.quality_rating ?? limits.quality_rating ?? 'GREEN',
      resolvedLimit
    )

    return {
      success:       true,
      tier:          String(resolvedLimit),
      qualityRating: d.quality_rating ?? limits.quality_rating ?? 'GREEN',
    }
  },
}