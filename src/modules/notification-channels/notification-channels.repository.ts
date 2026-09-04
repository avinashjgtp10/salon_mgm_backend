// ============================================================
// SalonOx — Notification Channel Templates: Repository
// ============================================================

import pool from "../../config/database"
import { AutomationEventType } from "../whatsapp-automation/whatsapp-automation.types"
import { Channel, NotificationChannelTemplate } from "./notification-channels.types"
import { canSendEmail } from "../utils/notif-prefs"
import {
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_DEFAULT_ENABLED_EVENTS,
  DefaultPurchaseEventType,
  EVENT_VARIABLE_NAMES,
} from "./notification-channels-defaults"

// The old owner-preference event keys these two events' current email
// behavior is keyed under (NotificationsPage.tsx's NotifPrefs) — used only
// to compute the correct seed-time `enabled` value, once, per salon.
const LEGACY_EMAIL_PREF_KEY: Partial<Record<DefaultPurchaseEventType, string>> = {
  appointment_cancelled: "appointmentCancelled",
  payment_received: "appointmentCompleted",
}

async function seedEnabledFor(salonId: string, eventType: DefaultPurchaseEventType, channel: Channel): Promise<boolean> {
  if (channel !== "EMAIL") return false
  if (!EMAIL_DEFAULT_ENABLED_EVENTS.includes(eventType)) return false
  const legacyKey = LEGACY_EMAIL_PREF_KEY[eventType]
  if (!legacyKey) return true
  // Preserve exactly what the salon already gets today, including the rare
  // salon that already turned this preference off.
  return canSendEmail(salonId, legacyKey)
}

export const notificationChannelsRepository = {

  // Create-or-return-existing, one row per (salon, event, channel) — same
  // lazy-seed convention as wa_automation_templates' own
  // findOrSeedSalonPurchaseTemplate, so a fresh salon (or one that's never
  // touched this feature) always has something sensible to read/render.
  async findOrSeedTemplate(salonId: string, eventType: DefaultPurchaseEventType, channel: Channel): Promise<NotificationChannelTemplate> {
    const { rows } = await pool.query(
      `SELECT * FROM notification_channel_templates WHERE salon_id = $1 AND event_type = $2 AND channel = $3`,
      [salonId, eventType, channel]
    )
    if (rows[0]) return rows[0]

    const enabled = await seedEnabledFor(salonId, eventType, channel)
    const body = channel === "SMS" ? DEFAULT_SMS_TEMPLATES[eventType] : DEFAULT_EMAIL_TEMPLATES[eventType].body
    const subject = channel === "EMAIL" ? DEFAULT_EMAIL_TEMPLATES[eventType].subject : null

    const { rows: inserted } = await pool.query(
      `INSERT INTO notification_channel_templates (salon_id, event_type, channel, enabled, subject, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (salon_id, event_type, channel) DO UPDATE SET updated_at = notification_channel_templates.updated_at
       RETURNING *`,
      [salonId, eventType, channel, enabled, subject, body]
    )
    return inserted[0]
  },

  // Every PURCHASE_EVENTS member × both channels, seeding any that don't
  // exist yet — mirrors findAllSalonPurchaseTemplates' loop-and-seed shape.
  async findAllForSalon(salonId: string): Promise<NotificationChannelTemplate[]> {
    const eventTypes = Object.keys(EVENT_VARIABLE_NAMES) as DefaultPurchaseEventType[]
    const rows: NotificationChannelTemplate[] = []
    for (const eventType of eventTypes) {
      rows.push(await this.findOrSeedTemplate(salonId, eventType, "SMS"))
      rows.push(await this.findOrSeedTemplate(salonId, eventType, "EMAIL"))
    }
    return rows
  },

  async upsertSmsBody(salonId: string, eventType: DefaultPurchaseEventType, body: string): Promise<NotificationChannelTemplate> {
    await this.findOrSeedTemplate(salonId, eventType, "SMS")
    const { rows } = await pool.query(
      `UPDATE notification_channel_templates SET body = $4, updated_at = NOW()
       WHERE salon_id = $1 AND event_type = $2 AND channel = $3
       RETURNING *`,
      [salonId, eventType, "SMS", body]
    )
    return rows[0]
  },

  async upsertEmailContent(salonId: string, eventType: DefaultPurchaseEventType, subject: string, body: string): Promise<NotificationChannelTemplate> {
    await this.findOrSeedTemplate(salonId, eventType, "EMAIL")
    const { rows } = await pool.query(
      `UPDATE notification_channel_templates SET subject = $4, body = $5, updated_at = NOW()
       WHERE salon_id = $1 AND event_type = $2 AND channel = $3
       RETURNING *`,
      [salonId, eventType, "EMAIL", subject, body]
    )
    return rows[0]
  },

  async setEnabled(salonId: string, eventType: DefaultPurchaseEventType, channel: Channel, enabled: boolean): Promise<NotificationChannelTemplate> {
    await this.findOrSeedTemplate(salonId, eventType, channel)
    const { rows } = await pool.query(
      `UPDATE notification_channel_templates SET enabled = $4, updated_at = NOW()
       WHERE salon_id = $1 AND event_type = $2 AND channel = $3
       RETURNING *`,
      [salonId, eventType, channel, enabled]
    )
    return rows[0]
  },

  // Minimal client contact lookup for the dispatcher — kept local here
  // rather than extending clients.repository.ts, since this is the only
  // caller and it only ever needs these four columns.
  async findClientContact(clientId: string): Promise<{
    email: string | null
    phone_number: string | null
    phone_country_code: string | null
    email_notifications: boolean
    sms_notifications: boolean
  } | null> {
    const { rows } = await pool.query(
      `SELECT email, phone_number, phone_country_code, email_notifications, sms_notifications
       FROM clients WHERE id = $1`,
      [clientId]
    )
    return rows[0] ?? null
  },

  async logSend(params: {
    salonId: string
    clientId: string | null
    channel: Channel
    eventType: AutomationEventType
    recipient: string
    status: "SENT" | "FAILED" | "SKIPPED"
    providerMessageId?: string | null
    failureReason?: string | null
    referenceId?: string | null
    referenceType?: string | null
  }): Promise<void> {
    await pool.query(
      `INSERT INTO notification_channel_logs
         (salon_id, client_id, channel, event_type, recipient, status, provider_message_id, failure_reason, reference_id, reference_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.salonId, params.clientId, params.channel, params.eventType, params.recipient,
        params.status, params.providerMessageId ?? null, params.failureReason ?? null,
        params.referenceId ?? null, params.referenceType ?? null,
      ]
    )
  },
}
