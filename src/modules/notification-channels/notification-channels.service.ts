// ============================================================
// SalonOx — Notification Channel Templates: Service
// ============================================================

import logger from "../../config/logger"
import config from "../../config/env"
import { transporter } from "../utils/email.service"
import { AutomationTriggerPayload } from "../whatsapp-automation/whatsapp-automation.types"
import { notificationChannelsRepository } from "./notification-channels.repository"
import { positionalToNamed, renderTemplate, renderChannelEmailHtml } from "./notification-channels.render"
import { validateSmsBody, validateEmailContent, requirePurchaseEvent } from "./notification-channels.validators"
import { isPurchaseEventType, DefaultPurchaseEventType } from "./notification-channels-defaults"
import { NotificationChannelTemplate, Channel } from "./notification-channels.types"
import { msg91SendSms, isMsg91Configured } from "./msg91.provider"

// Deliberately a small local copy, not an import from
// whatsapp-automation.service.ts — that module now imports THIS one for the
// trigger() fan-out call, so importing back would create a require cycle.
// Same formatting logic as that file's own formatPhone().
function formatPhoneForSms(phone: string, countryCode?: string | null): string {
  const digits = phone.replace(/\D/g, "")
  if (countryCode) {
    const cc = countryCode.replace(/\D/g, "")
    if (digits.startsWith(cc)) return digits
    return cc + digits
  }
  if (digits.length === 10) return "91" + digits
  return digits
}

// No SMS provider is currently wired up — Fast2SMS and SMSHorizon were both
// tried and abandoned (Fast2SMS's key never worked; SMSHorizon's account has
// no DLT registration, so every send got silently REJECTD by the carrier
// with TEMPLATE_NOT_MATCHED — confirmed via their own /status API, not just
// an assumption). This throws so dispatchSms/sendTest fail loudly and get
// logged as FAILED, instead of the trigger system silently pretending SMS
// works. MSG91 is now wired below; to swap in a different provider, write a
// `xyzSendSms(...) => Promise<{ sid, status }>` function and call it from
// sendSmsViaProvider — nothing else in this file (templates, toggles, logging,
// Send Test) needs to change. Throw errors carrying `status`/`statusCode` (or
// a Node `code`, or `permanent: true`) so isRetryableSmsError below can tell a
// transient provider fault from a permanent rejection instead of assuming.
//
// Note for India: transactional SMS needs DLT registration (sender ID +
// carrier-approved template IDs) before anything delivers, whichever provider
// is chosen — that's what sank the last attempt, and why the send below is
// addressed by template id + variables rather than by the rendered body.
const NO_SMS_PROVIDER = "No SMS provider configured"

async function sendSmsViaProvider(params: {
  to: string
  body: string
  eventType: string
  variables: Record<string, string>
}): Promise<{ sid: string; status: string }> {
  if (!isMsg91Configured()) throw new Error(NO_SMS_PROVIDER)
  return msg91SendSms({ to: params.to, eventType: params.eventType, variables: params.variables })
}

// ── Provider failure handling ────────────────────────────────────────────────
// Only transient faults are worth re-sending: a network blip, a provider 5xx,
// or rate limiting. A rejected number, a malformed/unregistered template or a
// missing provider will fail identically every time, so retrying them just
// delays the FAILED log by twenty minutes and triples the provider bill on
// anything that did partially go out. Unknown errors are treated as transient,
// since the cost of one extra attempt is lower than dropping a real message.
const SMS_RETRY_DELAYS_MS = [0, 30_000, 120_000] // immediate, +30s, +2min

function isRetryableSmsError(err: any): boolean {
  const message = String(err?.message ?? "")
  if (message === NO_SMS_PROVIDER) return false
  // Providers flag their own known-permanent conditions (bad auth, unknown or
  // unregistered DLT template, explicit carrier rejection).
  if (err?.permanent === true) return false

  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status)
  if (Number.isFinite(status)) return status === 429 || status >= 500

  // Node/undici transport failures — the provider was never reached.
  const code = String(err?.code ?? "")
  if (/^(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_)/.test(code)) return true

  // Carrier-side permanent rejections, whatever the transport said.
  if (/TEMPLATE_NOT_MATCHED|INVALID_NUMBER|DND|BLOCKED|UNSUBSCRIB|NOT_REGISTERED/i.test(message)) return false

  return true
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Deliberately permissive — this exists to reject obvious non-addresses, not
// to adjudicate RFC 5322. Anything shaped like local@domain.tld passes and is
// left for SMTP to accept or bounce.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
const isPlausibleEmail = (value: string): boolean => EMAIL_RE.test(value)

// Resolves with the provider result, or throws the final error carrying how
// many attempts were made so the delivery log records it.
async function sendSmsWithRetry(params: { to: string; body: string; eventType: string; variables: Record<string, string> }): Promise<{ sid: string; status: string; attempts: number }> {
  let lastErr: any = new Error("SMS send failed")
  let attemptsMade = 0

  for (let attempt = 1; attempt <= SMS_RETRY_DELAYS_MS.length; attempt++) {
    if (SMS_RETRY_DELAYS_MS[attempt - 1] > 0) await sleep(SMS_RETRY_DELAYS_MS[attempt - 1])
    attemptsMade = attempt
    try {
      const result = await sendSmsViaProvider({
        to: params.to, body: params.body, eventType: params.eventType, variables: params.variables,
      })
      if (attempt > 1) logger.info(`[NOTIF-CHANNELS] SMS ${params.eventType} succeeded on attempt ${attempt}`)
      return { ...result, attempts: attempt }
    } catch (err: any) {
      lastErr = err
      if (!isRetryableSmsError(err)) break
      if (attempt < SMS_RETRY_DELAYS_MS.length) {
        logger.warn(`[NOTIF-CHANNELS] SMS ${params.eventType} attempt ${attempt} failed (${err?.message}) — retrying`)
      }
    }
  }

  lastErr.smsAttempts = attemptsMade
  throw lastErr
}

export const notificationChannelsService = {

  // ── Admin CRUD (frontend-facing) ──────────────────────────────────────────

  async list(salonId: string): Promise<NotificationChannelTemplate[]> {
    return notificationChannelsRepository.findAllForSalon(salonId)
  },

  async updateSmsBody(salonId: string, eventTypeRaw: string, body: string): Promise<NotificationChannelTemplate> {
    const eventType = requirePurchaseEvent(eventTypeRaw)
    const existing = await notificationChannelsRepository.findOrSeedTemplate(salonId, eventType, "SMS")
    validateSmsBody(body, eventType, existing.enabled)
    return notificationChannelsRepository.upsertSmsBody(salonId, eventType, body)
  },

  async updateEmailContent(salonId: string, eventTypeRaw: string, subject: string, body: string): Promise<NotificationChannelTemplate> {
    const eventType = requirePurchaseEvent(eventTypeRaw)
    const existing = await notificationChannelsRepository.findOrSeedTemplate(salonId, eventType, "EMAIL")
    validateEmailContent(subject, body, eventType, existing.enabled)
    return notificationChannelsRepository.upsertEmailContent(salonId, eventType, subject, body)
  },

  async setEnabled(salonId: string, eventTypeRaw: string, channel: Channel, enabled: boolean): Promise<NotificationChannelTemplate> {
    const eventType = requirePurchaseEvent(eventTypeRaw)
    if (enabled) {
      const existing = await notificationChannelsRepository.findOrSeedTemplate(salonId, eventType, channel)
      if (channel === "SMS") validateSmsBody(existing.body, eventType, true)
      else validateEmailContent(existing.subject ?? "", existing.body, eventType, true)
    }
    return notificationChannelsRepository.setEnabled(salonId, eventType, channel, enabled)
  },

  // Fires one real SMS/Email right now, outside the event/template system —
  // for the Marketing settings page's "Send Test" button, so verifying a
  // provider is actually wired up doesn't require completing a real
  // checkout. Unlike dispatchSms/dispatchEmail below, this is NOT
  // fire-and-forget: it throws on failure so the caller (controller) can
  // show the real error immediately, and it isn't written to
  // notification_channel_logs — that table is for real automation events,
  // not manual pokes.
  async sendTest(channel: Channel, to: string): Promise<{ providerId: string | null }> {
    const testMessage = "This is a test message from your SalonOx notification settings."
    if (channel === "SMS") {
      // A test SMS is still a real transactional SMS, so DLT applies to it too
      // — there is no "just send this text" path. It needs its own registered
      // template, keyed "test" in MSG91_DLT_TEMPLATE_IDS. Deliberately no
      // retry: the owner is waiting on this request and wants the real error,
      // not a response held for two and a half minutes.
      const result = await sendSmsViaProvider({
        to: formatPhoneForSms(to),
        body: testMessage,
        eventType: "test",
        variables: { message: testMessage },
      })
      return { providerId: result.sid || null }
    }
    const result = await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: "Test email from SalonOx",
      html: renderChannelEmailHtml({ subject: "Test email from SalonOx", bodyText: testMessage, salonName: "" }),
    })
    return { providerId: result.messageId ?? null }
  },

  // ── Send fan-out ───────────────────────────────────────────────────────────
  // Called from whatsappAutomationService.trigger() (fire-and-forget, right
  // after its dedup guard) and from receipt-send.helper.ts's
  // sendPurchaseReceipt() for bill_receipt, which bypasses trigger() entirely.
  // Never throws — same contract trigger() itself has.
  async dispatchNonWhatsappChannels(payload: AutomationTriggerPayload): Promise<void> {
    if (!isPurchaseEventType(payload.eventType)) return // legacy global marketing events stay WhatsApp-only
    const eventType = payload.eventType as DefaultPurchaseEventType

    // Extras win over the positional names, so a call site can both fill the
    // Meta-approved six and supply richer tokens the email template can use.
    const namedVars = { ...positionalToNamed(payload.eventType, payload.variables), ...(payload.extraVariables ?? {}) }

    await Promise.allSettled([
      this.dispatchSms(payload, eventType, namedVars),
      this.dispatchEmail(payload, eventType, namedVars),
    ])
  },

  async dispatchSms(payload: AutomationTriggerPayload, eventType: DefaultPurchaseEventType, namedVars: Record<string, string>): Promise<void> {
    try {
      if (payload.clientId) {
        const client = await notificationChannelsRepository.findClientContact(payload.clientId)
        if (client && client.sms_notifications === false) return
      }
      if (!payload.phone || payload.phone.trim().length < 5) return

      const tpl = await notificationChannelsRepository.findOrSeedTemplate(payload.salonId, eventType, "SMS")
      if (!tpl.enabled) return

      const rendered = renderTemplate(tpl.body, namedVars, false)
      const to = formatPhoneForSms(payload.phone, payload.countryCode)

      try {
        const result = await sendSmsWithRetry({ to, body: rendered, eventType, variables: namedVars })
        await notificationChannelsRepository.logSend({
          salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "SMS", eventType,
          recipient: to, status: "SENT", providerMessageId: result.sid,
          referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
        })
      } catch (err: any) {
        // The attempt count goes into failure_reason because the log table has
        // no column for it — without that, a transient failure retried three
        // times is indistinguishable from one that was never retried at all.
        const attempts = Number(err?.smsAttempts) || 1
        const reason = `${err?.message ?? "Unknown error"}${attempts > 1 ? ` (after ${attempts} attempts)` : ""}`
        logger.error(`[NOTIF-CHANNELS] SMS send failed for ${eventType} after ${attempts} attempt(s):`, err?.message)
        await notificationChannelsRepository.logSend({
          salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "SMS", eventType,
          recipient: to, status: "FAILED", failureReason: reason,
          referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
        })
      }
    } catch (err: any) {
      logger.error(`[NOTIF-CHANNELS] dispatchSms error for ${eventType}:`, err?.message)
    }
  },

  async dispatchEmail(payload: AutomationTriggerPayload, eventType: DefaultPurchaseEventType, namedVars: Record<string, string>): Promise<void> {
    let to = payload.email ?? null
    try {
      if (payload.clientId) {
        const client = await notificationChannelsRepository.findClientContact(payload.clientId)
        if (client) {
          if (client.email_notifications === false) return
          to = to ?? client.email
        }
      }
      // Not just "present" — client records collected at a counter routinely
      // hold things like "-" or "na", and handing those to SMTP just produces
      // a FAILED row per event for a customer who was never reachable.
      to = to?.trim() ?? null
      if (!to || !isPlausibleEmail(to)) return

      const tpl = await notificationChannelsRepository.findOrSeedTemplate(payload.salonId, eventType, "EMAIL")
      if (!tpl.enabled) return

      const subject = renderTemplate(tpl.subject ?? "", namedVars, true)
      const bodyHtml = renderTemplate(tpl.body, namedVars, true)
      const html = renderChannelEmailHtml({ subject, bodyText: bodyHtml, salonName: namedVars.salon_name ?? "" })

      // Recorded as PENDING before the handoff to SMTP, then resolved in place.
      // A send that hangs or dies mid-flight then still leaves a row, instead
      // of looking like it was never attempted. logPending returns null on a
      // database whose status constraint predates PENDING, in which case this
      // falls back to logging the outcome only.
      const logId = await notificationChannelsRepository.logPending({
        salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "EMAIL", eventType,
        recipient: to, referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
      })

      try {
        const result = await transporter.sendMail({
          from: config.smtp.from,
          to,
          subject,
          html,
          attachments: payload.emailAttachment
            ? [{ filename: payload.emailAttachment.filename, content: payload.emailAttachment.buffer }]
            : undefined,
        })
        if (logId) {
          await notificationChannelsRepository.finalizeLog(logId, { status: "SENT", providerMessageId: result.messageId })
        } else {
          await notificationChannelsRepository.logSend({
            salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "EMAIL", eventType,
            recipient: to, status: "SENT", providerMessageId: result.messageId,
            referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
          })
        }
      } catch (err: any) {
        logger.error(`[NOTIF-CHANNELS] Email send failed for ${eventType}:`, err?.message)
        if (logId) {
          await notificationChannelsRepository.finalizeLog(logId, { status: "FAILED", failureReason: err?.message ?? "Unknown error" })
        } else {
          await notificationChannelsRepository.logSend({
            salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "EMAIL", eventType,
            recipient: to, status: "FAILED", failureReason: err?.message ?? "Unknown error",
            referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
          })
        }
      }
    } catch (err: any) {
      logger.error(`[NOTIF-CHANNELS] dispatchEmail error for ${eventType}:`, err?.message)
    }
  },
}
