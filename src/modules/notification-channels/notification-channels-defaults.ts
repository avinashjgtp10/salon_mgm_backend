// ============================================================
// SalonOx — Notification Channel Templates: Defaults
// ============================================================
// Default starting wording per (event, channel) — SMS and Email are always
// their own copy, never a truncated/rewrapped version of the other or of
// the WhatsApp default (see bill_receipt: SMS is a genuine short summary,
// not the email content cut short).
//
// SMS defaults deliberately use "Rs." not "₹" — the rupee sign isn't in the
// GSM-7 SMS character set, so using it silently drops every default from a
// 160-char segment budget to a 70-char Unicode one. See smsSegments.ts on
// the frontend for the counter that surfaces this to a salon editing their
// own wording.
//
// EVENT_VARIABLE_NAMES/isPurchaseEventType are imported read-only from
// wa-automation-defaults.ts — this file never modifies that one.

import { DefaultPurchaseEventType, EVENT_VARIABLE_NAMES, isPurchaseEventType } from "../whatsapp-automation/wa-automation-defaults"

export { EVENT_VARIABLE_NAMES, isPurchaseEventType }
export type { DefaultPurchaseEventType }

export const DEFAULT_SMS_TEMPLATES: Record<DefaultPurchaseEventType, string> = {
  client_welcome:
    "Hi {{customer_name}}, welcome to {{salon_name}}! We're happy to have you with us.",
  package_purchased:
    "Hi {{customer_name}}, thanks for purchasing {{package_name}} ({{total_sessions}} sessions, valid till {{expiry_date}}). Invoice: {{invoice_number}}.",
  membership_purchased:
    "Hi {{customer_name}}, your {{membership_name}} is now active, valid till {{expiry_date}}. Invoice: {{invoice_number}}.",
  // Deliberately short — a concise summary, not the email content cut down.
  // No {{items}} breakdown here on purpose; the feedback_line already
  // carries an optional link.
  bill_receipt:
    "Hi {{customer_name}}, thanks for visiting {{salon_name}}! Your bill is settled. {{feedback_line}}",
  appointment_confirmation:
    "Hi {{customer_name}}, your appointment at {{salon_name}} is confirmed. Date: {{appointment_date}}, Time: {{appointment_time}}, Service: {{service_name}}.",
  appointment_rescheduled:
    "Hi {{customer_name}}, your {{salon_name}} appointment moved to {{new_date}} {{new_time}} (was {{old_date}} {{old_time}}).",
  appointment_cancelled:
    "Hi {{customer_name}}, your {{appointment_date}} {{appointment_time}} appointment at {{salon_name}} has been cancelled.",
  payment_received:
    "Hi {{customer_name}}, your bill of Rs.{{amount}} at {{salon_name}} has been paid. Thank you!",
  package_expiring_7d:
    "Hi {{customer_name}}, your {{package_name}} expires on {{expiry_date}} ({{remaining_sessions}} sessions left). Book now!",
  package_expiring_24h:
    "Hi {{customer_name}}, your {{package_name}} expires tomorrow ({{remaining_sessions}} sessions left). Book now!",
  membership_expiring_7d:
    "Hi {{customer_name}}, your {{membership_name}} membership expires on {{expiry_date}} (Rs.{{remaining_balance}} left).",
  membership_expiring_24h:
    "Hi {{customer_name}}, your {{membership_name}} membership expires tomorrow (Rs.{{remaining_balance}} left).",
  package_session_used:
    "Hi {{customer_name}}, your {{service_name}} session from {{package_name}} is used. {{remaining_sessions}} session(s) left.",
  membership_session_used:
    "Hi {{customer_name}}, Rs.{{amount_used}} used from your membership for {{service_name}}. Balance: Rs.{{remaining_balance}}.",
  package_appointment_reminder_24h:
    "Reminder: {{customer_name}}, your {{service_name}} appointment at {{salon_name}} is tomorrow at {{appointment_time}} (uses 1 session from {{package_name}}).",
  service_reminder_24h:
    "Reminder: {{customer_name}}, your {{service_name}} appointment at {{salon_name}} is tomorrow at {{appointment_time}}.",
  reward_points_earned:
    "Hi {{customer_name}}, you earned {{points_earned}} reward points at {{salon_name}}! Total: {{total_points}}.",
  referral_reward:
    "Hi {{customer_name}}, you earned a referral reward for {{referred_customer_name}}'s visit to {{salon_name}}! Reward: {{reward}}.",
  ewallet_used:
    "Hi {{customer_name}}, Rs.{{amount_used}} used from your eWallet at {{salon_name}}. Balance: Rs.{{remaining_balance}}.",
  referral_credit_used:
    "Hi {{customer_name}}, Rs.{{amount_used}} used from your Referral Balance at {{salon_name}}. Balance: Rs.{{remaining_balance}}.",
  reward_points_used:
    "Hi {{customer_name}}, {{points_used}} reward points used at {{salon_name}}. Remaining: {{remaining_points}}.",
}

export const DEFAULT_EMAIL_TEMPLATES: Record<DefaultPurchaseEventType, { subject: string; body: string }> = {
  client_welcome: {
    subject: "Welcome to {{salon_name}}!",
    body: "Hi {{customer_name}},\n\nWelcome to {{salon_name}}! We're happy to have you with us.\n\nThank you for choosing us — we look forward to seeing you soon.",
  },
  package_purchased: {
    subject: "Your {{package_name}} purchase is confirmed",
    body: "Hi {{customer_name}},\n\nThank you for purchasing our {{package_name}}!\n\nPackage: {{package_name}}\nServices: {{services}}\nSessions: {{total_sessions}}\nValid Until: {{expiry_date}}\nAmount: Rs.{{package_value}}\nInvoice: {{invoice_number}}\n\nWe look forward to seeing you again. Book your next visit with us!",
  },
  membership_purchased: {
    subject: "Your {{membership_name}} membership is active",
    body: "Hi {{customer_name}},\n\nYour {{membership_name}} is now active!\n\nMembership: {{membership_name}}\nBenefit: {{benefit}}\nStart Date: {{start_date}}\nValid Until: {{expiry_date}}\nMembership Price: Rs.{{membership_price}}\nInvoice: {{invoice_number}}\n\nEnjoy your exclusive membership benefits on your future visits!",
  },
  bill_receipt: {
    subject: "Thank you for visiting {{salon_name}}",
    body: "Hi {{customer_name}},\n\nThank you for visiting {{salon_name}}. We hope you had a great experience! Your bill is attached with this email.\n\n{{items}}\n\n{{feedback_line}}\n\nThank you for choosing {{salon_name}} — we appreciate you!",
  },
  appointment_confirmation: {
    subject: "Appointment Confirmed at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nYour appointment has been successfully confirmed.\n\nAppointment Details:\nSalon: {{salon_name}}\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\nStaff: {{staff_name}}\n\nWe look forward to seeing you!",
  },
  appointment_rescheduled: {
    subject: "Your appointment at {{salon_name}} has been rescheduled",
    body: "Hi {{customer_name}},\n\nYour appointment at {{salon_name}} has been rescheduled.\n\nPrevious: {{old_date}} at {{old_time}}\nNew: {{new_date}} at {{new_time}}\nService: {{service_name}}\nStaff: {{staff_name}}\n\nWe look forward to seeing you!",
  },
  appointment_cancelled: {
    // Transcribed from email.service.ts's sendAppointmentCancelledEmail —
    // the one event with genuine prior client-facing content to preserve.
    subject: "Your Appointment has been Cancelled — {{salon_name}}",
    body: "Hi {{customer_name}},\n\nYour appointment at {{salon_name}} has been cancelled.\n\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\n\nPlease contact us if you'd like to rebook or if you have any questions.",
  },
  payment_received: {
    // Transcribed from email.service.ts's sendAppointmentCompletedEmail,
    // adapted to this event's actual variable set (that method's own params
    // — services/amount only — don't include appointment_date/time).
    subject: "Your Appointment Receipt — {{salon_name}}",
    body: "Hi {{customer_name}},\n\nThank you for visiting {{salon_name}}. Here's your receipt:\n\nAmount Paid: Rs.{{amount}}\nAppointment: {{appointment_date}} at {{appointment_time}}\n\nWe hope to see you again soon!",
  },
  package_expiring_7d: {
    subject: "Your {{package_name}} expires in 7 days",
    body: "Hi {{customer_name}},\n\nYour {{package_name}} is expiring in 7 days.\n\nExpiry Date: {{expiry_date}}\nSessions Remaining: {{remaining_sessions}}\n\nDon't miss out on your remaining sessions! Book your next visit today.",
  },
  package_expiring_24h: {
    subject: "Your {{package_name}} expires tomorrow",
    body: "Hi {{customer_name}},\n\nYour {{package_name}} expires tomorrow.\n\nSessions Remaining: {{remaining_sessions}}\nExpiry Date: {{expiry_date}}\n\nYou still have time to use your remaining sessions. Book your appointment now.",
  },
  membership_expiring_7d: {
    subject: "Your {{membership_name}} membership expires in 7 days",
    body: "Hi {{customer_name}},\n\nYour {{membership_name}} membership expires in 7 days.\n\nExpiry Date: {{expiry_date}}\nBalance Remaining: Rs.{{remaining_balance}}\n\nMake the most of your remaining membership benefits before it expires.",
  },
  membership_expiring_24h: {
    subject: "Your {{membership_name}} membership expires tomorrow",
    body: "Hi {{customer_name}},\n\nYour {{membership_name}} membership expires tomorrow.\n\nRemaining Balance: Rs.{{remaining_balance}}\nExpiry Date: {{expiry_date}}\n\nDon't let your remaining membership balance go unused.",
  },
  package_session_used: {
    subject: "Session used — {{package_name}}",
    body: "Hi {{customer_name}},\n\nYour {{service_name}} service has been successfully redeemed from your {{package_name}}.\n\nSessions Remaining: {{remaining_sessions}}\nServices Remaining: {{remaining_services_breakdown}}\n\nThank you for visiting {{salon_name}} — we appreciate you!",
  },
  membership_session_used: {
    subject: "Membership balance used at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nYour {{service_name}} service has been successfully redeemed from your membership.\n\nAmount Used: Rs.{{amount_used}}\nRemaining Balance: Rs.{{remaining_balance}}\n\nThank you for visiting {{salon_name}} — we appreciate you!",
  },
  package_appointment_reminder_24h: {
    subject: "Reminder: Your appointment tomorrow at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nJust a reminder that you have an appointment tomorrow at {{salon_name}}.\n\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\n\nThis appointment will use 1 session from your {{package_name}}. See you tomorrow!",
  },
  service_reminder_24h: {
    subject: "Reminder: Your appointment tomorrow at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nThis is a reminder for your appointment tomorrow at {{salon_name}}.\n\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\nStaff: {{staff_name}}\n\nWe look forward to seeing you tomorrow!",
  },
  reward_points_earned: {
    subject: "You earned {{points_earned}} reward points!",
    body: "Hi {{customer_name}},\n\nYou've earned {{points_earned}} reward points from your recent visit to {{salon_name}}.\n\nPoints Earned: {{points_earned}}\nTotal Points: {{total_points}}\n\nKeep visiting and earning rewards!",
  },
  referral_reward: {
    subject: "Your referral reward has been credited",
    body: "Hi {{customer_name}},\n\nGreat news! Your referral {{referred_customer_name}} has completed their qualifying visit at {{salon_name}}.\n\nReferral Reward: {{reward}}\nYour Total Reward Points: {{total_points}}\n\nThank you for spreading the word!",
  },
  ewallet_used: {
    subject: "eWallet used at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nYour eWallet was used for a payment at {{salon_name}}.\n\nAmount Used: Rs.{{amount_used}}\nRemaining Balance: Rs.{{remaining_balance}}\n\nThank you for choosing {{salon_name}} — we appreciate you!",
  },
  referral_credit_used: {
    subject: "Referral Balance used at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nYour Referral Balance was used for a payment at {{salon_name}}.\n\nAmount Used: Rs.{{amount_used}}\nRemaining Referral Balance: Rs.{{remaining_balance}}\n\nThank you for choosing {{salon_name}} — we appreciate you!",
  },
  reward_points_used: {
    subject: "Reward Points used at {{salon_name}}",
    body: "Hi {{customer_name}},\n\nYour Reward Points were used for a payment at {{salon_name}}.\n\nPoints Used: {{points_used}}\nRemaining Points: {{remaining_points}}\n\nThank you for choosing {{salon_name}} — we appreciate you!",
  },
}

// The 2 events that already had genuine client-facing email content before
// this feature existed — seeded enabled=true (computed from the salon's
// *current* preference, see repository.findOrSeedTemplate) so no salon
// regresses. Every other event's email default seeds enabled=false — no
// email for it ever existed before, so "not configured" correctly means
// "don't send" rather than surprising a salon with new mail.
export const EMAIL_DEFAULT_ENABLED_EVENTS: DefaultPurchaseEventType[] = [
  "appointment_cancelled",
  "payment_received",
]
