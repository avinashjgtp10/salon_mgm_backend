// ============================================================
// SalonOx — WhatsApp Automation Service
// ============================================================

import logger from '../../config/logger'
import { whatsappMetaApi } from '../marketing/whatsapp/shared/whatsapp.api'
import { configRepository } from '../marketing/whatsapp/config/config.repository'
import { whatsappAutomationRepository } from './whatsapp-automation.repository'
import { waScheduledMessagesRepository } from './wa-scheduled-messages.repository'
import { notificationChannelsService } from '../notification-channels/notification-channels.service'
import {
  AutomationEventType,
  AutomationTriggerPayload,
  UpdateSalonAutomationSettingBody,
  ListAutomationLogsFilters,
  MARKETING_EVENTS,
} from './whatsapp-automation.types'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Format phone to E.164 e.g. "+91" + "9876543210" → "919876543210"
export function formatPhone(phone: string, countryCode?: string | null): string {
  const digits = phone.replace(/\D/g, '')
  if (countryCode) {
    const cc = countryCode.replace(/\D/g, '')
    if (digits.startsWith(cc)) return digits
    return cc + digits
  }
  // Default to India if no country code provided
  if (digits.length === 10) return '91' + digits
  return digits
}

// Build Meta API components from variables, plus an optional per-recipient
// URL button suffix (e.g. a feedback link token) when the template has one.
function buildComponents(variables: Record<string, string>, buttonSuffix?: string | null): any[] {
  const params = Object.values(variables).map(val => ({ type: 'text', text: String(val) }))
  const components: any[] = []
  if (params.length > 0) components.push({ type: 'body', parameters: params })
  if (buttonSuffix) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: buttonSuffix }],
    })
  }
  return components
}

// Calculate next retry time based on attempt number
// Attempt 1 → immediate (null, already handled)
// Attempt 2 → +1 minute
// Attempt 3 → +5 minutes
// Attempt 4 → +15 minutes → then FAILED permanently
function getNextRetryAt(attemptCount: number): Date | null {
  const delays: Record<number, number> = { 1: 1, 2: 5, 3: 15 }
  const minutes = delays[attemptCount]
  if (!minutes) return null
  const next = new Date()
  next.setMinutes(next.getMinutes() + minutes)
  return next
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Core Service ──────────────────────────────────────────────────────────────

export const whatsappAutomationService = {

  /**
   * Main entry point.
   * Call from any service with .catch(() => {}) — NEVER throws to caller.
   *
   * Flow:
   * 1. Check client opted in (whatsapp_notifications or whatsapp_marketing)
   * 2. Check salon has this automation enabled
   * 3. Fetch global template config
   * 4. Get the salon's own WA credentials (same account used for marketing campaigns)
   * 5. Format phone
   * 6. Create log entry
   * 7. Send via Meta API with retry
   */
  async trigger(payload: AutomationTriggerPayload): Promise<void> {
    const { salonId, eventType, clientId, phone, countryCode, variables, referenceId, referenceType, dedupeByReference } = payload

    try {
      logger.info(`[WA-TRACE] trigger START`, { eventType, salonId, clientId: clientId ?? null, referenceId: referenceId ?? null, phone })

      // 1. Validate phone
      if (!phone || phone.trim().length < 5) {
        logger.info(`[WA-TRACE] SKIP ${eventType} — no valid phone`)
        return
      }

      // 1b. Atomic once-per-(event,reference) guard for event-driven sends —
      // ON CONFLICT DO NOTHING closes the check-then-send race that a plain
      // "does a log exist?" read leaves open. Won-the-race → proceed; lost → a
      // duplicate is already in flight/sent, skip silently.
      if (dedupeByReference && referenceId) {
        const won = await whatsappAutomationRepository.guardInsertIfNotExists(`trigger:${eventType}:${referenceId}`)
        if (!won) {
          logger.info(`[WA-TRACE] SKIP ${eventType} — duplicate for reference ${referenceId}`)
          return
        }
      }

      // 1c. SMS/Email fan-out — deliberately BEFORE the WhatsApp-specific
      // gates below (salon-automation-enabled, Meta config, template lookup)
      // so a salon with no WhatsApp set up still gets SMS/Email. Fire-and-
      // forget, same "never blocks/throws to caller" contract this function
      // itself has — see notification-channels.service.ts.
      notificationChannelsService.dispatchNonWhatsappChannels(payload).catch(() => {})

      // 2. Check salon has this automation enabled
      const salonEnabled = await whatsappAutomationRepository.isSalonAutomationEnabled(salonId, eventType)
      if (!salonEnabled) {
        logger.info(`[WA-TRACE] SKIP ${eventType} — salon ${salonId} disabled this automation`)
        return
      }

      // 2b. Respect the client's WhatsApp opt-out. The scheduler jobs filter on
      // these flags in SQL, but the event-driven call sites (confirmations,
      // purchases, thank-you, etc.) route through here without checking — so a
      // client who opted out of WhatsApp would still be messaged. Only skip on
      // an explicit opt-out (unknown/walk-in client falls through and sends).
      if (clientId) {
        const optIn = await whatsappAutomationRepository.getClientOptIn(clientId)
        const isMarketing = MARKETING_EVENTS.includes(eventType)
        if (optIn && ((isMarketing && !optIn.marketing) || (!isMarketing && !optIn.notifications))) {
          logger.info(`[WA-TRACE] SKIP ${eventType} — client ${clientId} opted out of ${isMarketing ? 'marketing' : 'notifications'}`)
          return
        }
      }

      // 3. Fetch template — salon's own approved copy for purchase events, else the global row
      const template = await whatsappAutomationRepository.findTemplate(eventType, salonId)
      if (!template) {
        logger.info(`[WA-TRACE] SKIP ${eventType} — no active/APPROVED template for this salon (submit & get it approved first)`)
        return
      }

      // 4. Get the salon's own WA credentials — billed to the salon, not the platform
      const salonConfig = await configRepository.findBySalonId(salonId)
      if (!salonConfig?.phone_number_id || !salonConfig?.access_token) {
        logger.info(`[WA-TRACE] SKIP ${eventType} — salon ${salonId} has no WhatsApp config (phone_number_id/access_token missing)`)
        return
      }

      // 5. Format phone
      const formattedPhone = formatPhone(phone, countryCode)
      logger.info(`[WA-TRACE] SENDING ${eventType} → ${formattedPhone} using template "${template.template_name}" (${template.language})`)

      // 6. Create log
      const log = await whatsappAutomationRepository.createLog({
        salonId,
        clientId:      clientId      ?? null,
        phone:         formattedPhone,
        eventType,
        templateName:  template.template_name,
        referenceId:   referenceId   ?? null,
        referenceType: referenceType ?? null,
        status:        'QUEUED',
      })

      // 7. Send with retry
      await this.sendWithRetry({
        logId:         log.id,
        phoneNumberId: salonConfig.phone_number_id,
        accessToken:   salonConfig.access_token,
        to:            formattedPhone,
        templateName:  template.template_name,
        language:      template.language,
        variables,
        buttonSuffix:  template.has_button ? payload.buttonSuffix ?? undefined : undefined,
      })

    } catch (err: any) {
      logger.error(`[WA-AUTO] trigger() error for ${eventType}:`, { salonId, clientId, error: err?.message })
    }
  },

  // ── Send With Retry ───────────────────────────────────────────────────────
  // Attempt 1: immediate
  // Attempt 2: after 1 min
  // Attempt 3: after 5 min
  // Attempt 4: after 15 min → mark FAILED permanently
  async sendWithRetry(params: {
    logId:         string
    phoneNumberId: string
    accessToken:   string
    to:            string
    templateName:  string
    language:      string
    variables:     Record<string, string>
    buttonSuffix?: string | null
  }): Promise<void> {
    const MAX_ATTEMPTS = 4
    const DELAYS_MS    = [0, 60_000, 300_000, 900_000] // 0, 1min, 5min, 15min

    const { logId, phoneNumberId, accessToken, to, templateName, language, variables, buttonSuffix } = params
    const components = buildComponents(variables, buttonSuffix)

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Wait before retry (first attempt delay is 0)
      if (DELAYS_MS[attempt - 1] > 0) {
        await sleep(DELAYS_MS[attempt - 1])
      }

      try {
        const result = await whatsappMetaApi.sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to,
          templateName,
          language,
          components,
        })

        const wamid = result?.messages?.[0]?.id ?? null
        if (wamid) {
          await whatsappAutomationRepository.markSent(logId, wamid)
          logger.info(`[WA-TRACE] ✅ SENT ${templateName} to ${to} (wamid: ${wamid})`)
        } else {
          logger.warn(`[WA-TRACE] ⚠️ SENT ${templateName} to ${to} but Meta returned no wamid — marking failed`)
          await whatsappAutomationRepository.markFailed(logId, 'No wamid in response', result ?? {}, null)
        }
        return

      } catch (err: any) {
        const errorMsg     = err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error'
        const errorCode    = err?.response?.data?.error?.code ?? '—'
        const metaResponse = err?.response?.data ?? {}

        logger.warn(`[WA-TRACE] ❌ FAILED ${templateName} to ${to} — attempt ${attempt}/${MAX_ATTEMPTS} — Meta [${errorCode}] ${errorMsg}`)

        const nextRetryAt = attempt < MAX_ATTEMPTS ? getNextRetryAt(attempt) : null
        await whatsappAutomationRepository.markFailed(logId, errorMsg, metaResponse, nextRetryAt)

        if (attempt === MAX_ATTEMPTS) {
          logger.error(`[WA-AUTO] ❌ All ${MAX_ATTEMPTS} attempts exhausted for log ${logId}`)
          return
        }
      }
    }
  },

  // ── Webhook Delivery Handler ──────────────────────────────────────────────
  // Called from webhooks.service.ts — returns true if handled
  async handleDeliveryStatus(wamid: string, type: string, timestamp: Date): Promise<boolean> {
    const log = await whatsappAutomationRepository.findByWamid(wamid)
    if (!log) return false

    if (type === 'DELIVERED') {
      await whatsappAutomationRepository.markDelivered(wamid, timestamp)
    } else if (type === 'READ') {
      await whatsappAutomationRepository.markRead(wamid, timestamp)
    } else if (type === 'FAILED') {
      const reason = 'FAILED via webhook'
      await whatsappAutomationRepository.markFailedByWamid(wamid, reason)
      // The scheduled-message row (if any) was already marked SENT right
      // after Meta's initial "accepted" response — this webhook is the only
      // signal that it actually failed, so correct it now or the table would
      // show SENT forever for a message that never arrived.
      await waScheduledMessagesRepository.markFailedByLogId(log.id, reason)
    }

    return true
  },

  // ── Admin: Template Management ────────────────────────────────────────────

  async getAllTemplates() {
    return whatsappAutomationRepository.findAllTemplates()
  },

  async updateTemplate(eventType: AutomationEventType, templateName: string, language: string) {
    return whatsappAutomationRepository.updateTemplateName(eventType, templateName, language)
  },

  async toggleTemplate(eventType: AutomationEventType, isActive: boolean) {
    return whatsappAutomationRepository.toggleTemplate(eventType, isActive)
  },

  // ── Salon: Automation Settings ────────────────────────────────────────────

  async getSalonSettings(salonId: string) {
    return whatsappAutomationRepository.getSalonSettings(salonId)
  },

  async updateSalonSetting(salonId: string, body: UpdateSalonAutomationSettingBody) {
    return whatsappAutomationRepository.upsertSalonSetting(salonId, body)
  },

  // ── Logs ──────────────────────────────────────────────────────────────────

  async getLogs(filters: ListAutomationLogsFilters) {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20
    const { data, total } = await whatsappAutomationRepository.listLogs({ ...filters, page, limit })
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  },

  // ── Scheduler Jobs ────────────────────────────────────────────────────────

  // package_expiring_7d/24h, membership_expiring_7d/24h,
  // package_appointment_reminder_24h, service_reminder_24h, birthday_wishes,
  // we_miss_you_30/60/90d, new_year_campaign, pending_payment_reminder — all
  // moved to the Scheduled Templates system (see wa-scheduled-messages.
  // service.ts). Package/membership/appointment/birthday events are now
  // scheduled as real rows the moment their source entity is created; the
  // condition-based ones (pending payment, we-miss-you) are a 1-day rolling
  // preview upserted nightly. The actual send for all of them now goes
  // through waScheduledMessagesService.runDueTick(), not this file — do not
  // re-add per-event run*() methods here for any SCHEDULABLE_EVENTS member,
  // it would double-send alongside the new path.
}