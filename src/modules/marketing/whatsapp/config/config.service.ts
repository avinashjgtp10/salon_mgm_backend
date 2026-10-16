import { AppError } from '../../../../middleware/error.middleware'
import { configRepository } from './config.repository'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { SaveConfigBody, TestConnectionResult } from './config.types'
import logger from '../../../../config/logger'
import { waPurchaseTemplatesService } from '../../../whatsapp-automation/wa-purchase-templates.service'
import { dashboardRepository } from '../dashboard/dashboard.repository'

// APP_URL = your backend domain e.g. https://api.salonox.com
// Each salon gets their own webhook URL with their salonId in it
function getWebhookUrl(salonId: string): string {
  const base = process.env.APP_URL ?? 'https://your-app.onrender.com'
  return `${base}/api/v1/webhooks/${salonId}/meta`
}

// A connection saved without its display number (the Super Admin form does not ask for it) is filled in from
// Meta the first time it is needed, then kept. A failed lookup is not retried for a while, so a bad token or a
// Meta outage cannot turn every config read into a Meta call.
const DISPLAY_PHONE_RETRY_MS = 10 * 60 * 1000
const displayPhoneFailedAt = new Map<string, number>()

async function withDisplayPhone<T extends { salon_id?: any; phone_number_id?: any; access_token?: any; display_phone?: any }>(
  salonId: string,
  config: T,
): Promise<T> {
  if (String(config.display_phone ?? '').trim() || !config.phone_number_id || !config.access_token) return config
  const failedAt = displayPhoneFailedAt.get(salonId)
  if (failedAt && Date.now() - failedAt < DISPLAY_PHONE_RETRY_MS) return config
  try {
    const found = await whatsappMetaApi.verifyPhoneNumberId({ phoneNumberId: config.phone_number_id, accessToken: config.access_token })
    if (found.valid && found.displayPhone) {
      const updated = await configRepository.setDisplayPhone(salonId, found.displayPhone)
      displayPhoneFailedAt.delete(salonId)
      return { ...config, display_phone: updated?.display_phone ?? found.displayPhone }
    }
    displayPhoneFailedAt.set(salonId, Date.now())
  } catch (err: any) {
    displayPhoneFailedAt.set(salonId, Date.now())
    logger.warn('[wa-config] could not look up the display phone number', { salonId, error: err?.message })
  }
  return config
}

// The messaging tier (daily limit) and quality rating live on Meta, so the config read refreshes them from
// Meta instead of trusting the stored copy (which the 6-hourly scheduler alone can leave hours stale after a
// tier upgrade). Throttled per salon so the many report pages that load this config don't each call Meta, and
// bounded by a timeout so a slow Meta never delays the page — on any failure the stored value is used.
const LIMIT_REFRESH_MS = 5 * 60 * 1000
const LIMIT_REFRESH_TIMEOUT_MS = 4000
const limitRefreshedAt = new Map<string, number>()

async function refreshLimitsFromMeta<T extends { is_verified?: any }>(salonId: string, config: T): Promise<T> {
  // Only an already-verified connection — syncLimitsForSalon marks the row verified, which must never happen
  // as a side effect of merely reading an unverified config.
  if (!config.is_verified) return config
  const last = limitRefreshedAt.get(salonId)
  if (last && Date.now() - last < LIMIT_REFRESH_MS) return config
  limitRefreshedAt.set(salonId, Date.now())
  try {
    const refreshed = await Promise.race([
      configService.syncLimitsForSalon(salonId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LIMIT_REFRESH_TIMEOUT_MS)),
    ])
    if (refreshed) return { ...config, ...refreshed }
  } catch (err: any) {
    logger.warn('[wa-config] live limit refresh from Meta failed', { salonId, error: err?.message })
  }
  return config
}

export const configService = {

  // revealSecrets: true returns the real access_token / app_secret instead of the
  // masked form. Only the controller passes true, and only for a caller who holds
  // edit_whatsapp_config - everyone else (including staff who merely view the
  // Inbox/Campaigns) keeps getting the redacted values.
  async getConfig(salonId: string, revealSecrets: boolean = false) {
    const found = await configRepository.findBySalonId(salonId)
    if (!found) return null
    const config = await refreshLimitsFromMeta(salonId, await withDisplayPhone(salonId, found))
    // sent_today powers the Send Campaign modal's "messages remaining today"
    // usage bar — cheap enough to compute on every config fetch, and this is
    // the endpoint every report/campaign page already loads waConfig from.
    const sentToday = await dashboardRepository.getSentToday(salonId)
    return {
      ...config,
      access_token: revealSecrets
        ? (config.access_token ?? null)
        : config.access_token
          ? config.access_token.slice(0, 8) + '••••••••'
          : null,
      app_secret: revealSecrets
        ? (config.app_secret ?? null)
        : config.app_secret ? '••••••••' : null,
      sent_today: sentToday,
    }
  },

  async setAiReceptionistEnabled(salonId: string, enabled: boolean) {
    const updated = await configRepository.setAiReceptionistEnabled(salonId, enabled)
    if (!updated) throw new AppError(400, 'WhatsApp not configured for this salon', 'WA_NOT_CONFIGURED')
    return { ai_receptionist_enabled: updated.ai_receptionist_enabled }
  },

  async saveConfig(salonId: string, body: SaveConfigBody) {

    // Trim EVERY credential field before anything touches it. These are all
    // used in exact-match lookups (webhook verify token, phone_number_id) or
    // string-concatenated into Meta tokens (app_id|app_secret), so a single
    // stray copy-paste space silently breaks webhook verification / sends —
    // this was a real, confirmed production incident.
    const trim = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : ''
      return s.length > 0 ? s : null
    }

    const cleanBody: SaveConfigBody = {
      phone_number_id:      trim(body.phone_number_id),
      waba_id:              trim(body.waba_id),
      app_id:               trim(body.app_id),
      app_secret:           trim(body.app_secret),
      access_token:         trim(body.access_token),
      webhook_verify_token: trim(body.webhook_verify_token),
      display_phone:        typeof body.display_phone === 'string' ? body.display_phone.trim() : (body.display_phone ?? null),
    } as SaveConfigBody

    // ── Check verify token uniqueness (using the trimmed value) ───────────────
    if (cleanBody.webhook_verify_token) {
      const taken = await configRepository.isVerifyTokenTaken(
        cleanBody.webhook_verify_token,
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

    // Read BEFORE the upsert — "was this salon already configured" has to
    // reflect the state prior to this exact save, so editing an existing
    // config (e.g. rotating the access token) never re-triggers the
    // first-time bulk template submission below.
    const existingBefore = await configRepository.findBySalonId(salonId)
    const wasConfiguredBefore = !!existingBefore?.phone_number_id

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

    // ── First-time setup complete — submit every default trigger template ────
    // Fire-and-forget: 24 individual Meta submissions can take a while and
    // saveConfig's own response shouldn't wait on it, same reasoning as the
    // webhook auto-registration above. Only fires once, the moment
    // phone_number_id first appears on this salon's config row.
    if (!wasConfiguredBefore && saved.phone_number_id) {
      waPurchaseTemplatesService.submitAllDefaults(salonId).catch((err) =>
        logger.error(`⚠️  submitAllDefaults failed for salon ${salonId}: ${err?.message}`)
      )
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
      (await withDisplayPhone(salonId, config)).display_phone ?? '',
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