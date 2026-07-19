// ============================================================
// SalonOx — WhatsApp Automation Service
// ============================================================

import logger from '../../config/logger'
import { whatsappMetaApi } from '../marketing/whatsapp/shared/whatsapp.api'
import { configRepository } from '../marketing/whatsapp/config/config.repository'
import { whatsappAutomationRepository } from './whatsapp-automation.repository'
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

// Build Meta API body components from variables
function buildComponents(variables: Record<string, string>): any[] {
  const params = Object.values(variables).map(val => ({ type: 'text', text: String(val) }))
  if (params.length === 0) return []
  return [{ type: 'body', parameters: params }]
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

// ── IST Date Formatters ───────────────────────────────────────────────────────
function formatDateIST(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatTimeIST(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
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
  }): Promise<void> {
    const MAX_ATTEMPTS = 4
    const DELAYS_MS    = [0, 60_000, 300_000, 900_000] // 0, 1min, 5min, 15min

    const { logId, phoneNumberId, accessToken, to, templateName, language, variables } = params
    const components = buildComponents(variables)

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
      await whatsappAutomationRepository.markFailedByWamid(wamid, 'FAILED via webhook')
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

  async runAppointmentReminders(): Promise<void> {
    logger.info('[WA-AUTO] Running appointment reminder job...')
    try {
      const appointments = await whatsappAutomationRepository.getAppointmentsForReminder()
      logger.info(`[WA-AUTO] ${appointments.length} appointments to remind`)

      for (const appt of appointments) {
        if (!appt.phone_number) continue

        await this.trigger({
          salonId:       appt.salon_id,
          eventType:     'appointment_reminder_24h',
          clientId:      appt.client_id,
          phone:         appt.phone_number,
          countryCode:   appt.phone_country_code,
          variables: {
            '1': appt.client_name  ?? 'Valued Customer',
            '2': appt.salon_name   ?? 'our salon',
            '3': formatDateIST(appt.scheduled_at),
            '4': formatTimeIST(appt.scheduled_at),
          },
          referenceId:   appt.appointment_id,
          referenceType: 'appointment',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runAppointmentReminders error:', err?.message)
    }
  },

  async runAppointmentReminders1h(): Promise<void> {
    logger.info('[WA-AUTO] Running 1-hour appointment reminder job...')
    try {
      const appointments = await whatsappAutomationRepository.getAppointmentsForReminder1h()
      logger.info(`[WA-AUTO] ${appointments.length} appointments to remind (1h)`)

      for (const appt of appointments) {
        if (!appt.phone_number) continue

        await this.trigger({
          salonId:       appt.salon_id,
          eventType:     'appointment_reminder_1h',
          clientId:      appt.client_id,
          phone:         appt.phone_number,
          countryCode:   appt.phone_country_code,
          variables: {
            '1': appt.client_name  ?? 'Valued Customer',
            '2': appt.salon_name   ?? 'our salon',
            '3': formatTimeIST(appt.scheduled_at),
          },
          referenceId:   appt.appointment_id,
          referenceType: 'appointment',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runAppointmentReminders1h error:', err?.message)
    }
  },

  async runPackageExpiringReminders(): Promise<void> {
    logger.info('[WA-AUTO] Running package expiring reminder job...')
    try {
      const packages = await whatsappAutomationRepository.getPackagesExpiringIn7Days()

      for (const pkg of packages) {
        if (!pkg.phone_number) continue

        const guardKey = `package-expiring:${pkg.package_id}`
        const inserted = await whatsappAutomationRepository.guardInsertIfNotExists(guardKey)
        if (!inserted) continue

        await this.trigger({
          salonId:       pkg.salon_id,
          eventType:     'package_expiring_soon',
          clientId:      pkg.client_id,
          phone:         pkg.phone_number,
          countryCode:   pkg.phone_country_code,
          variables: {
            '1': pkg.client_name  ?? 'Valued Customer',
            '2': pkg.package_name,
            '3': formatDateIST(pkg.expiry_date),
          },
          referenceId:   pkg.package_id,
          referenceType: 'package',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runPackageExpiringReminders error:', err?.message)
    }
  },

  async runBirthdayWishes(): Promise<void> {
    logger.info('[WA-AUTO] Running birthday wishes job...')
    try {
      const clients = await whatsappAutomationRepository.getClientsBirthday()
      const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // YYYY-MM-DD

      for (const client of clients) {
        const guardKey    = `birthday:${client.client_id}:${todayIST}`
        const inserted = await whatsappAutomationRepository.guardInsertIfNotExists(guardKey)
        if (!inserted) continue

        await this.trigger({
          salonId:       client.salon_id,
          eventType:     'birthday_wishes',
          clientId:      client.client_id,
          phone:         client.phone_number,
          countryCode:   client.phone_country_code,
          variables: {
            '1': client.full_name,
            '2': client.salon_name ?? 'our salon',
          },
          referenceId:   client.client_id,
          referenceType: 'client',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runBirthdayWishes error:', err?.message)
    }
  },

  async runPendingPaymentReminders(): Promise<void> {
    logger.info('[WA-AUTO] Running pending payment reminder job...')
    try {
      const sales = await whatsappAutomationRepository.getOverdueSales()

      for (const sale of sales) {
        if (!sale.phone_number) continue

        // Dedup — don't send again today if already sent
        const todayIST    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        const guardKey    = `pending-payment:${sale.sale_id}:${todayIST}`
        const inserted = await whatsappAutomationRepository.guardInsertIfNotExists(guardKey)
        if (!inserted) continue

        const dueDate = sale.due_date
          ? formatDateIST(sale.due_date)
          : 'as soon as possible'

        await this.trigger({
          salonId:       sale.salon_id,
          eventType:     'pending_payment_reminder',
          clientId:      sale.client_id,
          phone:         sale.phone_number,
          countryCode:   sale.phone_country_code,
          variables: {
            '1': sale.client_name  ?? 'Valued Customer',
            '2': sale.total_amount ?? '0',
            '3': dueDate,
          },
          referenceId:   sale.sale_id,
          referenceType: 'sale',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runPendingPaymentReminders error:', err?.message)
    }
  },

  async runMembershipRenewalReminders(): Promise<void> {
    logger.info('[WA-AUTO] Running membership renewal reminder job...')
    try {
      const memberships = await whatsappAutomationRepository.getMembershipsExpiringIn7Days()

      for (const mem of memberships) {
        if (!mem.phone_number) continue

        const guardKey    = `membership-renewal:${mem.membership_id}`
        const inserted = await whatsappAutomationRepository.guardInsertIfNotExists(guardKey)
        if (!inserted) continue

        await this.trigger({
          salonId:       mem.salon_id,
          eventType:     'membership_renewal_reminder',
          clientId:      mem.client_id,
          phone:         mem.phone_number,
          countryCode:   mem.phone_country_code,
          variables: {
            '1': mem.client_name     ?? 'Valued Customer',
            '2': mem.membership_name,
            '3': formatDateIST(mem.expiry_date),
          },
          referenceId:   mem.membership_id,
          referenceType: 'membership',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runMembershipRenewalReminders error:', err?.message)
    }
  },

  async runWeMissYou(days: 30 | 60 | 90): Promise<void> {
    const eventType: AutomationEventType =
      days === 30 ? 'we_miss_you_30d' :
      days === 60 ? 'we_miss_you_60d' : 'we_miss_you_90d'

    logger.info(`[WA-AUTO] Running we-miss-you ${days}d job...`)
    try {
      const clients  = await whatsappAutomationRepository.getInactiveClients(days)
      const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

      for (const client of clients) {
        const guardKey    = `we-miss-you-${days}d:${client.client_id}:${todayIST}`
        const inserted = await whatsappAutomationRepository.guardInsertIfNotExists(guardKey)
        if (!inserted) continue

        await this.trigger({
          salonId:       client.salon_id,
          eventType,
          clientId:      client.client_id,
          phone:         client.phone_number,
          countryCode:   client.phone_country_code,
        variables: {
  '1': client.full_name,
  '2': String(days),
  '3': client.salon_name ?? 'our salon',
},
          referenceId:   client.client_id,
          referenceType: 'client',
        })
      }
    } catch (err: any) {
      logger.error(`[WA-AUTO] runWeMissYou(${days}d) error:`, err?.message)
    }
  },

  async runNewYearCampaign(): Promise<void> {
    // Self-guard: only runs on Jan 1 IST
    const dateIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    if (dateIST.getMonth() !== 0 || dateIST.getDate() !== 1) return

    logger.info('[WA-AUTO] Running New Year campaign job...')
    try {
      const year    = dateIST.getFullYear()
      const clients = await whatsappAutomationRepository.getAllActiveSalonClients()

      for (const client of clients) {
        const guardKey    = `new-year:${year}:${client.client_id}`
        const inserted = await whatsappAutomationRepository.guardInsertIfNotExists(guardKey)
        if (!inserted) continue

        await this.trigger({
          salonId:       client.salon_id,
          eventType:     'new_year_campaign',
          clientId:      client.client_id,
          phone:         client.phone_number,
          countryCode:   client.phone_country_code,
          variables: {
            '1': client.full_name,
            '2': client.salon_name ?? 'our salon',
          },
          referenceId:   client.client_id,
          referenceType: 'client',
        })
      }
    } catch (err: any) {
      logger.error('[WA-AUTO] runNewYearCampaign error:', err?.message)
    }
  },
}