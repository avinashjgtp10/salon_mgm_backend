// ============================================================
// SalonOx — Notification Channel Templates (SMS / Email) Types
// ============================================================
// Sibling to whatsapp-automation's own template system, but deliberately
// simpler: no Meta-style approval lifecycle. "Save" is live immediately.

import { AutomationEventType, AutomationTriggerPayload } from "../whatsapp-automation/whatsapp-automation.types"

export type Channel = "SMS" | "EMAIL"

export type NotificationChannelTemplate = {
  id:         string
  salon_id:   string
  event_type: AutomationEventType
  channel:    Channel
  enabled:    boolean
  subject:    string | null   // EMAIL only
  body:       string
  created_at: string
  updated_at: string
}

export type UpdateSmsBody = { body: string }
export type UpdateEmailBody = { subject: string; body: string }
export type SetEnabledBody = { enabled: boolean }

// Re-exported for convenience so call sites only need one import for the
// dispatch entry point's payload shape.
export type { AutomationTriggerPayload }
