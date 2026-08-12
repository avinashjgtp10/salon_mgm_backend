// ============================================================
// SalonOx — WhatsApp Automation Types
// ============================================================

// ── Event Types ───────────────────────────────────────────────────────────────
export type AutomationEventType =
  | 'appointment_confirmation'
  | 'appointment_reminder_24h'
  | 'appointment_reminder_1h'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  // Reminders for an appointment booked out of a package sale (see
  // client_package_service_schedules). Separate from the generic
  // appointment_reminder_* events so the copy can name the package and
  // reassure the client the visit is already paid for — those generic
  // sweeps deliberately skip package-linked appointments so nobody gets
  // both messages for one visit.
  | 'package_appointment_reminder_2d'
  | 'package_appointment_reminder_1d'
  | 'invoice_generated'
  | 'payment_received'
  | 'pending_payment_reminder'
  | 'service_purchased'
  | 'product_purchased'
  | 'membership_purchased'
  | 'package_purchased'
  | 'membership_renewal_reminder'
  | 'package_expiring_soon'
  | 'thank_you'
  | 'review_request'
  | 'sessions_remaining'
  | 'birthday_wishes'
  | 'new_year_campaign'
  | 'we_miss_you_30d'
  | 'we_miss_you_60d'
  | 'we_miss_you_90d'

// Salon-owner-editable events — submitted to Meta under the salon's own WABA
// (see wa-purchase-templates.service.ts), unlike every other event type which
// still uses the single global admin-managed row. Originally just the 4
// purchase-completion events, now covers the salon's full lifecycle catalog.
//
// appointment_confirmation/appointment_reminder_24h/appointment_rescheduled
// moved in here from the legacy global-row model — that model assumed one
// Meta template submission works for every salon, which is impossible since
// template approval is per-WABA and every salon has their own. Confirmed live
// in prod: both were failing for every salon with Meta error (#132001)
// "Template name does not exist in the translation" for exactly this reason.
export const PURCHASE_EVENTS: AutomationEventType[] = [
  'service_purchased',
  'product_purchased',
  'membership_purchased',
  'package_purchased',
  'appointment_reminder_1h',
  'thank_you',
  'review_request',
  'package_expiring_soon',
  'sessions_remaining',
  'appointment_confirmation',
  'appointment_reminder_24h',
  'appointment_rescheduled',
  'package_appointment_reminder_2d',
  'package_appointment_reminder_1d',
]

// Transactional events — controlled by client.whatsapp_notifications
export const TRANSACTIONAL_EVENTS: AutomationEventType[] = [
  'appointment_confirmation',
  'appointment_reminder_24h',
  'appointment_rescheduled',
  'appointment_cancelled',
  'invoice_generated',
  'payment_received',
  'pending_payment_reminder',
  ...PURCHASE_EVENTS,
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
// Legacy rows (salon_id IS NULL) are global, one per event type, managed by
// SalonOx admin only. Rows for PURCHASE_EVENTS have salon_id set — each salon
// owns and submits their own copy to Meta under their own WABA.
export type TemplateSubmissionStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'

export type AutomationTemplate = {
  id:                string
  salon_id:          string | null
  event_type:        AutomationEventType
  template_name:     string    // Meta template name (legacy: pre-set; purchase events: minted on submit)
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
  // Optional single CTA-URL button — currently only review_request uses this,
  // but kept generic on the row so any future event can opt in the same way.
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
  // Event-driven call sites (confirmations, purchases, thank-you, etc.) set
  // this so trigger() sends at most once per (eventType, referenceId), using an
  // atomic guard — prevents double messages from a retry, a double-submit, or
  // two call sites firing the same event for the same record. Recurring
  // scheduler events (reminders, birthday) leave it off; they do their own
  // date-keyed guarding and intentionally re-send over time.
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