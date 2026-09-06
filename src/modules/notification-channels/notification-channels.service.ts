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
// works. To wire up a new provider: write a
// `xyzSendSms({ to, body }) => Promise<{ sid, status }>` function (same
// shape exotel.service.ts's old exotelSendSms had) and call it from here —
// nothing else in this file (templates, toggles, logging, Send Test) needs
// to change.
async function sendSmsViaProvider(_params: { to: string; body: string }): Promise<{ sid: string; status: string }> {
  throw new Error("No SMS provider configured")
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
      const result = await sendSmsViaProvider({ to: formatPhoneForSms(to), body: testMessage })
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

    const namedVars = positionalToNamed(payload.eventType, payload.variables)

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
        const result = await sendSmsViaProvider({ to, body: rendered })
        await notificationChannelsRepository.logSend({
          salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "SMS", eventType,
          recipient: to, status: "SENT", providerMessageId: result.sid,
          referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
        })
      } catch (err: any) {
        logger.error(`[NOTIF-CHANNELS] SMS send failed for ${eventType}:`, err?.message)
        await notificationChannelsRepository.logSend({
          salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "SMS", eventType,
          recipient: to, status: "FAILED", failureReason: err?.message ?? "Unknown error",
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
      if (!to || !to.trim()) return

      const tpl = await notificationChannelsRepository.findOrSeedTemplate(payload.salonId, eventType, "EMAIL")
      if (!tpl.enabled) return

      const subject = renderTemplate(tpl.subject ?? "", namedVars, true)
      const bodyHtml = renderTemplate(tpl.body, namedVars, true)
      const html = renderChannelEmailHtml({ subject, bodyText: bodyHtml, salonName: namedVars.salon_name ?? "" })

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
        await notificationChannelsRepository.logSend({
          salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "EMAIL", eventType,
          recipient: to, status: "SENT", providerMessageId: result.messageId,
          referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
        })
      } catch (err: any) {
        logger.error(`[NOTIF-CHANNELS] Email send failed for ${eventType}:`, err?.message)
        await notificationChannelsRepository.logSend({
          salonId: payload.salonId, clientId: payload.clientId ?? null, channel: "EMAIL", eventType,
          recipient: to, status: "FAILED", failureReason: err?.message ?? "Unknown error",
          referenceId: payload.referenceId ?? null, referenceType: payload.referenceType ?? null,
        })
      }
    } catch (err: any) {
      logger.error(`[NOTIF-CHANNELS] dispatchEmail error for ${eventType}:`, err?.message)
    }
  },
}
