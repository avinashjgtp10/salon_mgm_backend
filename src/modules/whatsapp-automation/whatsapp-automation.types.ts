// ============================================================
// SalonOx — WhatsApp Automation Types
// ============================================================

// ── Event Types ───────────────────────────────────────────────────────────────
export type AutomationEventType =
  | 'appointment_confirmation'
  | 'appointment_reminder_24h'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'invoice_generated'
  | 'payment_received'
  | 'pending_payment_reminder'
  | 'membership_purchased'
  | 'membership_renewal_reminder'
  | 'birthday_wishes'
  | 'new_year_campaign'
  | 'we_miss_you_30d'
  | 'we_miss_you_60d'
  | 'we_miss_you_90d'

// Transactional events — controlled by client.whatsapp_notifications
export const TRANSACTIONAL_EVENTS: AutomationEventType[] = [
  'appointment_confirmation',
  'appointment_reminder_24h',
  'appointment_rescheduled',
  'appointment_cancelled',
  'invoice_generated',
  'payment_received',
  'pending_payment_reminder',
  'membership_purchased',
  'membership_renewal_reminder',
]

// Marketing events — controlled by client.whatsapp_marketing
export const MARKETING_EVENTS: AutomationEventType[] = [
  'birthday_wishes',
  'new_year_campaign',
  'we_miss_you_30d',
  'we_miss_you_60d',
  'we_miss_you_90d',
]

// ── Log Status ────────────────────────────────────────────────────────────────
export type AutomationLogStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'
  | 'SKIPPED'

// ── DB Row: wa_automation_logs ────────────────────────────────────────────────
export type AutomationLog = {
  id:              string
  salon_id:        string
  client_id:       string | null
  phone_number:    string
  event_type:      AutomationEventType
  template_name:   string
  meta_message_id: string | null
  status:          AutomationLogStatus
  reference_id:    string | null
  reference_type:  string | null
  failure_reason:  string | null
  meta_response:   any | null
  attempt_count:   number
  next_retry_at:   string | null
  sent_at:         string | null
  delivered_at:    string | null
  read_at:         string | null
  created_at:      string
  updated_at:      string
}

// ── DB Row: wa_automation_templates ──────────────────────────────────────────
// One global row per event type — managed by SalonOx admin only
export type AutomationTemplate = {
  id:            string
  event_type:    AutomationEventType
  template_name: string    // Meta approved template name
  language:      string    // e.g. 'en'
  is_active:     boolean
  created_at:    string
  updated_at:    string
}

// ── Platform WA Credentials (from ENV) ───────────────────────────────────────
export type PlatformWAConfig = {
  phoneNumberId: string
  accessToken:   string
  wabaId:        string
}

// ── Trigger Payload ───────────────────────────────────────────────────────────
export type AutomationTriggerPayload = {
  salonId:        string
  eventType:      AutomationEventType
  clientId?:      string | null
  phone:          string           // raw phone number
  countryCode?:   string | null    // e.g. '+91'
  variables:      Record<string, string>  // { '1': 'Nishant', '2': 'Style Studio', ... }
  referenceId?:   string | null
  referenceType?: string | null
}

// ── API Bodies ────────────────────────────────────────────────────────────────
export type UpdateSalonAutomationSettingBody = {
  event_type: AutomationEventType
  is_active:  boolean
}

export type ListAutomationLogsFilters = {
  salonId:     string
  eventType?:  AutomationEventType
  status?:     AutomationLogStatus
  clientId?:   string
  page?:       number
  limit?:      number
}