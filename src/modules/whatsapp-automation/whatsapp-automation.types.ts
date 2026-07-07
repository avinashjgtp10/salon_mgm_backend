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