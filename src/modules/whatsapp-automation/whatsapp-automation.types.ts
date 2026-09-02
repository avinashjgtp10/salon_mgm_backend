// ============================================================
// SalonOx — WhatsApp Automation Types
// ============================================================

// ── Event Types ───────────────────────────────────────────────────────────────
export type AutomationEventType =
  // Salon-editable trigger events (see PURCHASE_EVENTS below) — organized into
  // Quick Sale / Calendar / Other by the frontend Trigger Templates UI.
  | 'client_welcome'
  // service_purchased / product_purchased retired — fully redundant with
  // bill_receipt below, which itemizes every item type in a Quick Sale
  // regardless of how many were purchased. See sales.service.ts checkout().
  | 'package_purchased'
  | 'membership_purchased'
  // Meta-approved document-header template — the bill PDF is the template's
  // HEADER component, the thank-you/feedback text is its BODY. Real Meta
  // template like everything else below, so it delivers regardless of the
  // 24h customer-session window (no separate backup event needed).
  | 'bill_receipt'
  | 'appointment_confirmation'
  | 'appointment_rescheduled'
  | 'appointment_cancelled'
  | 'payment_received'
  | 'package_expiring_7d'
  | 'package_expiring_24h'
  | 'membership_expiring_7d'
  | 'membership_expiring_24h'
  | 'package_session_used'
  | 'membership_session_used'
  | 'package_appointment_reminder_24h'
  | 'service_reminder_24h'
  | 'reward_points_earned'
  | 'referral_reward'
  | 'ewallet_used'
  | 'referral_credit_used'
  | 'reward_points_used'
  // Legacy global (admin-managed, salon_id IS NULL) events, untouched by the
  // trigger-template rework.
  | 'pending_payment_reminder'
  | 'birthday_wishes'
  | 'new_year_campaign'
  | 'we_miss_you_30d'
  | 'we_miss_you_60d'
  | 'we_miss_you_90d'

// Salon-owner-editable events — submitted to Meta under the salon's own WABA
// (see wa-purchase-templates.service.ts), unlike the legacy events below which
// still use a single global admin-managed row.
export const PURCHASE_EVENTS: AutomationEventType[] = [
  'client_welcome',
  'package_purchased',
  'membership_purchased',
  'bill_receipt',
  'appointment_confirmation',
  'appointment_rescheduled',
  'appointment_cancelled',
  'payment_received',
  'package_expiring_7d',
  'package_expiring_24h',
  'membership_expiring_7d',
  'membership_expiring_24h',
  'package_session_used',
  'membership_session_used',
  'package_appointment_reminder_24h',
  'service_reminder_24h',
  'reward_points_earned',
  'referral_reward',
  'ewallet_used',
  'referral_credit_used',
  'reward_points_used',
]

// PURCHASE_EVENTS members that skip Meta template submission entirely (sent
// as a freeform caption instead of a template) — none currently. Kept as an
// extensibility point; a future event could opt back into this.
export const CAPTION_ONLY_EVENTS: AutomationEventType[] = []

// Transactional events — controlled by client.whatsapp_notifications
export const TRANSACTIONAL_EVENTS: AutomationEventType[] = [
  'pending_payment_reminder',
  ...PURCHASE_EVENTS,
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
// owns and submits their own copy to Meta under their own WABA (except
// CAPTION_ONLY_EVENTS, which never go to Meta at all).
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
  // Optional single CTA-URL button — unused by the current default catalog,
  // but kept generic on the row so any future event can opt in.
  has_button:        boolean
  button_text:       string | null
  button_url_base:   string | null
  // ── In-flight resubmission candidate ────────────────────────────────────
  // Set only while status = 'APPROVED' and the salon has edited + resubmitted
  // new wording — the row above (body_text/template_name/meta_template_id/
  // status) stays untouched and keeps serving live sends the whole time.
  // Promoted into those columns (and cleared here) only once Meta approves
  // this candidate — see wa-purchase-templates.service.ts's syncStatus().
  pending_body_text:        string | null
  pending_status:            'PENDING' | 'REJECTED' | null
  pending_template_name:     string | null
  pending_meta_template_id:  string | null
  pending_rejection_reason:  string | null
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

// ── Scheduled Templates ──────────────────────────────────────────────────────
// Events with a genuine future date, known the moment their source entity is
// created (a package's expiry date, an appointment's time, a client's
// birthday) — these get a REAL wa_scheduled_messages row created ahead of
// time, at source-creation, not computed by a same-instant poll like every
// other event above.
export const SCHEDULABLE_GROUP_A: AutomationEventType[] = [
  'package_expiring_7d',
  'package_expiring_24h',
  'membership_expiring_7d',
  'membership_expiring_24h',
  'package_appointment_reminder_24h',
  'service_reminder_24h',
  'birthday_wishes',
  'new_year_campaign',
]

// Events whose firing depends on an ongoing condition (an unpaid balance, a
// client's inactivity) that can resolve on any given day — no fixed date to
// commit to days in advance. Shown as a 1-day-ahead rolling preview,
// recomputed nightly; a row can vanish before it's ever due if the
// underlying condition stops being true.
export const SCHEDULABLE_GROUP_B: AutomationEventType[] = [
  'pending_payment_reminder',
  'we_miss_you_30d',
  'we_miss_you_60d',
  'we_miss_you_90d',
]

export const SCHEDULABLE_EVENTS: AutomationEventType[] = [
  ...SCHEDULABLE_GROUP_A,
  ...SCHEDULABLE_GROUP_B,
]

export type ScheduledMessageStatus =
  | 'SCHEDULED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'

export type ScheduledMessage = {
  id:                 string
  salon_id:           string
  client_id:          string | null
  phone_number:       string
  phone_country_code: string | null
  event_type:         AutomationEventType
  is_preview:         boolean
  reference_id:       string | null
  reference_type:     string | null
  scheduled_at:       string
  status:             ScheduledMessageStatus
  variables:          Record<string, string>
  message_preview:    string | null
  failure_reason:     string | null
  attempt_count:      number
  sent_at:            string | null
  cancelled_at:       string | null
  automation_log_id:  string | null
  created_at:         string
  updated_at:         string
}

export type UpsertScheduledParams = {
  salonId:           string
  clientId?:         string | null
  phone:             string
  countryCode?:      string | null
  eventType:         AutomationEventType
  referenceId:       string
  referenceType:     string
  scheduledAt:       Date | string
  variables:         Record<string, string>
  messagePreview:    string
  isPreview?:        boolean
}

export type ListScheduledMessagesFilters = {
  salonId:    string
  status?:    ScheduledMessageStatus | ScheduledMessageStatus[]
  eventType?: AutomationEventType | AutomationEventType[]
  clientId?:  string
  dateFrom?:  string
  dateTo?:    string
  search?:    string
  page?:      number
  limit?:     number
}