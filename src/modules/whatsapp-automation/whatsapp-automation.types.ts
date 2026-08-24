// ============================================================
// SalonOx — WhatsApp Automation Types
// ============================================================

// ── Event Types ───────────────────────────────────────────────────────────────
export type AutomationEventType =
  | 'appointment_cancelled'
  | 'invoice_generated'
  | 'payment_received'
  | 'pending_payment_reminder'
  | 'membership_renewal_reminder'
  | 'birthday_wishes'
  | 'new_year_campaign'
  | 'we_miss_you_30d'
  | 'we_miss_you_60d'
  | 'we_miss_you_90d'

// Transactional events — controlled by client.whatsapp_notifications
export const TRANSACTIONAL_EVENTS: AutomationEventType[] = [
  'appointment_cancelled',
  'invoice_generated',
  'payment_received',
  'pending_payment_reminder',
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

// All event types combined — used for validation
export const AUTOMATION_EVENT_TYPES: AutomationEventType[] = [
  ...TRANSACTIONAL_EVENTS,
  ...MARKETING_EVENTS,
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
// One row per event type, global, managed by SalonOx admin only.
export type TemplateSubmissionStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'

export type AutomationTemplate = {
  id:                string
  salon_id:          string | null
  event_type:        AutomationEventType
  template_name:     string    // Meta template name
  language:          string    // e.g. 'en'
  is_active:         boolean
  status:            TemplateSubmissionStatus
  category:          'UTILITY' | 'MARKETING'
  body_text:         string | null
  meta_template_id:  string | null
  rejection_reason:  string | null
  approved_at:       string | null
  created_at:        string
  updated_at:        string
  // Optional single CTA-URL button, kept generic on the row so any event can
  // opt in.
  has_button:        boolean
  button_text:       string | null
  button_url_base:   string | null
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
  // Event-driven call sites (invoice, payment, cancellation) set this so
  // trigger() sends at most once per (eventType, referenceId), using an
  // atomic guard — prevents double messages from a retry or a double-submit.
  // Recurring scheduler events (birthday, we-miss-you) leave it off; they do
  // their own date-keyed guarding and intentionally re-send over time.
  dedupeByReference?: boolean
  // Per-recipient suffix appended to the template's stored button_url_base at
  // send time (Meta's dynamic URL button mechanism). Only meaningful when the
  // resolved template has has_button = true; ignored otherwise.
  buttonSuffix?: string | null
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