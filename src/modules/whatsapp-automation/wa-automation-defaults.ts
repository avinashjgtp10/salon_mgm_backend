import { AppError } from "../../middleware/error.middleware";
import { AutomationEventType } from "./whatsapp-automation.types";

// Predefined starting wording for the salon-owner-editable events (see
// PURCHASE_EVENTS in whatsapp-automation.types.ts) a salon can edit and submit
// to Meta for approval under their own WABA.
//
// All placeholders — for every one of these events, including the ones that
// DO go to Meta — use the same friendly named format bill_receipt already
// used ({{customer_name}}, {{salon_name}}, ...), never Meta's raw {{1}}/{{2}}
// numbering. Meta itself still requires strict sequential {{1}}, {{2}}, ...
// numbering on the template it actually approves — EVENT_VARIABLE_NAMES below
// maps each event's named placeholders to their fixed Meta position (matching
// exactly what each trigger() call site already fills positionally), and
// toMetaNumberedBody() converts a salon's named-placeholder wording into that
// numbered form only at submission time. The salon never sees or edits a raw
// {{n}}; the DB's body_text/pending_body_text stay in named form always.
const FEEDBACK_FORM_BASE_URL =
    process.env.FRONTEND_URL || process.env.APP_BASE_URL || "http://localhost:5173";

export const DEFAULT_PURCHASE_TEMPLATES: Record<
    | "client_welcome" | "package_purchased"
    | "membership_purchased" | "bill_receipt" | "appointment_confirmation" | "appointment_rescheduled"
    | "appointment_cancelled" | "payment_received" | "package_expiring_7d" | "package_expiring_24h"
    | "membership_expiring_7d" | "membership_expiring_24h" | "package_session_used"
    | "membership_session_used" | "package_appointment_reminder_24h" | "service_reminder_24h"
    | "reward_points_earned" | "referral_reward" | "ewallet_used" | "referral_credit_used" | "reward_points_used",
    {
        label: string;
        category: "UTILITY";
        language: string;
        bodyText: string;
        button?: { text: string; urlBase: string };
    }
> = {
    client_welcome: {
        label: "New Client Welcome",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nWelcome to {{salon_name}}!\nWe're happy to have you with us.\nThank you for choosing {{salon_name}} — we appreciate you!",
    },
    package_purchased: {
        label: "Package Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nThank you for purchasing our {{package_name}}!\n\nPackage: {{package_name}}\nServices: {{services}}\nSessions: {{total_sessions}}\nValid Until: {{expiry_date}}\nAmount: ₹{{package_value}}\nInvoice: {{invoice_number}}\n\nWe look forward to seeing you again. Book your next visit with us!",
    },
    membership_purchased: {
        label: "Membership Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\n\n🎉 Your {{membership_name}} is now active!\n\nMembership: {{membership_name}}\nBenefit: {{benefit}}\nStart Date: {{start_date}}\nValid Until: {{expiry_date}}\nMembership Price: ₹{{membership_price}}\nInvoice: {{invoice_number}}\n\nEnjoy your exclusive membership benefits on your future visits!",
    },
    // Document-header Meta template — the bill PDF is submitted/sent as the
    // template's HEADER component (see wa-bill-receipt-template.helper.ts),
    // this bodyText is its BODY. {{items}} carries the server-built itemized
    // breakdown (one variable, multi-line value — Meta only restricts the
    // NUMBER/position of variables, not whether a given value spans multiple
    // lines). {{feedback_line}} carries either the real feedback link
    // (appointment-linked checkouts) or a fallback line (a true walk-in with
    // no appointment to attach one to).
    bill_receipt: {
        label: "Bill Receipt (Thank You + Feedback)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nThank you for visiting {{salon_name}}.\nWe hope you had a great experience!\nYour bill is attached with this message.\n{{items}}\n{{feedback_line}}\nThank you for choosing {{salon_name}} — we appreciate you!",
    },
    appointment_confirmation: {
        label: "Appointment Confirmation",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour appointment at {{salon_name}} is confirmed.\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\nStaff: {{staff_name}}\nWe look forward to seeing you!",
    },
    appointment_rescheduled: {
        label: "Appointment Rescheduled",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour appointment at {{salon_name}} has been rescheduled.\nPrevious: {{old_date}} at {{old_time}}\nNew: {{new_date}} at {{new_time}}\nService: {{service_name}}\nStaff: {{staff_name}}\nWe look forward to seeing you!",
    },
    appointment_cancelled: {
        label: "Appointment Cancelled",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour appointment at {{salon_name}} has been cancelled.\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\nIf you'd like to book another appointment, we're happy to help.",
    },
    payment_received: {
        label: "Payment Received (Appointment)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour bill of ₹{{amount}} at {{salon_name}} has been successfully paid.\nAppointment: {{appointment_date}}\nTime: {{appointment_time}}\nThank you for choosing {{salon_name}} — we appreciate you!",
    },
    package_expiring_7d: {
        label: "Package Expiring (7 Days)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour {{package_name}} is expiring in 7 days.\nExpiry Date: {{expiry_date}}\nSessions Remaining: {{remaining_sessions}}\nDon't miss out on your remaining sessions!\nBook your next visit today.",
    },
    package_expiring_24h: {
        label: "Package Expiring (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour {{package_name}} expires tomorrow.\nSessions Remaining: {{remaining_sessions}}\nExpiry Date: {{expiry_date}}\nYou still have time to use your remaining sessions.\nBook your appointment now.",
    },
    membership_expiring_7d: {
        label: "Membership Expiring (7 Days)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour {{membership_name}} membership expires in 7 days.\nExpiry Date: {{expiry_date}}\nBalance Remaining: ₹{{remaining_balance}}\nMake the most of your remaining membership benefits before it expires.",
    },
    membership_expiring_24h: {
        label: "Membership Expiring (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour {{membership_name}} membership expires tomorrow.\nRemaining Balance: ₹{{remaining_balance}}\nExpiry Date: {{expiry_date}}\nDon't let your remaining membership balance go unused.",
    },
    package_session_used: {
        label: "Package Session Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour {{service_name}} service has been successfully redeemed from your {{package_name}}.\nSession Used: 1\nSessions Remaining: {{remaining_sessions}}\nThank you for visiting {{salon_name}} — we appreciate you!",
    },
    membership_session_used: {
        label: "Membership Session Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour {{service_name}} service has been successfully redeemed from your membership.\nAmount Used: ₹{{amount_used}}\nRemaining Balance: ₹{{remaining_balance}}\nThank you for visiting {{salon_name}} — we appreciate you!",
    },
    package_appointment_reminder_24h: {
        label: "Package Appointment Reminder (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nJust a reminder that you have an appointment tomorrow at {{salon_name}}.\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\nThis appointment will use 1 session from your {{package_name}}.\nSee you tomorrow!",
    },
    service_reminder_24h: {
        label: "Appointment Reminder (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nThis is a reminder for your appointment tomorrow at {{salon_name}}.\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nService: {{service_name}}\nStaff: {{staff_name}}\nWe look forward to seeing you tomorrow!",
    },
    reward_points_earned: {
        label: "Reward Points Earned",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYou've earned {{points_earned}} reward points from your recent visit to {{salon_name}}.\nPoints Earned: {{points_earned}}\nTotal Points: {{total_points}}\nKeep visiting and earning rewards!",
    },
    referral_reward: {
        label: "Referral Reward Credited",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nGreat news! Your referral {{referred_customer_name}} has completed their qualifying visit at {{salon_name}}.\nReferral Reward: {{reward}}\nYour Total Reward Points: {{total_points}}\nThank you for spreading the word!",
    },
    ewallet_used: {
        label: "eWallet Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour eWallet was used for a payment at {{salon_name}}.\nAmount Used: ₹{{amount_used}}\nRemaining Balance: ₹{{remaining_balance}}\nThank you for choosing {{salon_name}} — we appreciate you!",
    },
    referral_credit_used: {
        label: "Referral Credit Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour Referral Balance was used for a payment at {{salon_name}}.\nAmount Used: ₹{{amount_used}}\nRemaining Referral Balance: ₹{{remaining_balance}}\nThank you for choosing {{salon_name}} — we appreciate you!",
    },
    reward_points_used: {
        label: "Reward Points Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}},\nYour Reward Points were used for a payment at {{salon_name}}.\nPoints Used: {{points_used}}\nRemaining Points: {{remaining_points}}\nThank you for choosing {{salon_name}} — we appreciate you!",
    },
};

export type DefaultPurchaseEventType = keyof typeof DEFAULT_PURCHASE_TEMPLATES;

export function isPurchaseEventType(eventType: AutomationEventType): eventType is DefaultPurchaseEventType {
    return eventType in DEFAULT_PURCHASE_TEMPLATES;
}

// ── Named-placeholder ↔ Meta {{n}} mapping ─────────────────────────────────
// Ordered so index+1 == the Meta template position — MUST match exactly what
// each event's trigger() call site fills positionally ('1', '2', '3', ...).
export const EVENT_VARIABLE_NAMES: Record<DefaultPurchaseEventType, string[]> = {
    client_welcome:       ["customer_name", "salon_name"],
    package_purchased:    ["customer_name", "package_name", "services", "total_sessions", "expiry_date", "package_value", "invoice_number"],
    membership_purchased: ["customer_name", "membership_name", "benefit", "start_date", "expiry_date", "membership_price", "invoice_number"],
    bill_receipt:         ["customer_name", "salon_name", "items", "feedback_line"],
    appointment_confirmation: ["customer_name", "salon_name", "appointment_date", "appointment_time", "service_name", "staff_name"],
    appointment_rescheduled:  ["customer_name", "salon_name", "old_date", "old_time", "new_date", "new_time", "service_name", "staff_name"],
    appointment_cancelled:    ["customer_name", "salon_name", "appointment_date", "appointment_time", "service_name"],
    payment_received:         ["customer_name", "amount", "salon_name", "appointment_date", "appointment_time"],
    package_expiring_7d:     ["customer_name", "package_name", "expiry_date", "remaining_sessions"],
    package_expiring_24h:    ["customer_name", "package_name", "remaining_sessions", "expiry_date"],
    membership_expiring_7d:  ["customer_name", "membership_name", "expiry_date", "remaining_balance"],
    membership_expiring_24h: ["customer_name", "membership_name", "remaining_balance", "expiry_date"],
    package_session_used:    ["customer_name", "service_name", "package_name", "remaining_sessions", "salon_name"],
    membership_session_used: ["customer_name", "service_name", "amount_used", "remaining_balance", "salon_name"],
    package_appointment_reminder_24h: ["customer_name", "salon_name", "appointment_date", "appointment_time", "service_name", "package_name"],
    service_reminder_24h:             ["customer_name", "salon_name", "appointment_date", "appointment_time", "service_name", "staff_name"],
    reward_points_earned: ["customer_name", "points_earned", "salon_name", "total_points"],
    referral_reward:      ["customer_name", "referred_customer_name", "salon_name", "reward", "total_points"],
    ewallet_used:         ["customer_name", "amount_used", "salon_name", "remaining_balance"],
    referral_credit_used: ["customer_name", "amount_used", "salon_name", "remaining_balance"],
    reward_points_used:   ["customer_name", "points_used", "salon_name", "remaining_points"],
};

// Converts a salon's named-placeholder wording into Meta's required
// sequential {{1}}, {{2}}, ... form, right before submission — the DB copy
// (body_text/pending_body_text) is never touched, only this transient
// submission payload. Each name always maps to its fixed position (matching
// the meaning trigger() already sends there), regardless of how many times
// it's used or where it appears in the salon's edited text — so reordering
// sentences is always safe, dropping a placeholder is not (see validation).
export function toMetaNumberedBody(bodyText: string, eventType: DefaultPurchaseEventType): string {
    const names = EVENT_VARIABLE_NAMES[eventType];
    if (!names) throw new AppError(400, `"${eventType}" does not go through Meta submission`, "VALIDATION_ERROR");

    let result = bodyText;
    names.forEach((name, idx) => {
        const re = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "gi");
        result = result.replace(re, `{{${idx + 1}}}`);
    });
    return result;
}

// Every required named placeholder for this event must appear at least once
// (a salon can reword freely and reuse a name, but can't drop one — trigger()
// always fills every position, so a missing placeholder would leave that data
// point unrenderable and, worse, could shift Meta's {{n}} numbering into a
// gap it rejects). Also rejects any {{...}} token that isn't a recognized
// name for this event, catching typos before they reach Meta as an opaque
// rejection.
export function validateNamedPlaceholders(bodyText: string, eventType: DefaultPurchaseEventType): void {
    const names = EVENT_VARIABLE_NAMES[eventType];
    if (!names) return;

    const found = [...bodyText.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase());
    const nameSet = new Set(names.map((n) => n.toLowerCase()));

    const unknown = [...new Set(found.filter((n) => !nameSet.has(n)))];
    if (unknown.length > 0) {
        throw new AppError(400, `Unknown variable(s): ${unknown.map((n) => `{{${n}}}`).join(", ")}`, "VALIDATION_ERROR");
    }

    const missing = names.filter((n) => !found.includes(n.toLowerCase()));
    if (missing.length > 0) {
        throw new AppError(400, `Missing required variable(s): ${missing.map((n) => `{{${n}}}`).join(", ")}`, "VALIDATION_ERROR");
    }
}

// bill_receipt's feedback link base — same mechanism the removed review_request
// event used, reused here since receipt-send.helper.ts builds the same kind of
// link (see generateFeedbackToken() in reviews/feedback-token.util.ts).
export { FEEDBACK_FORM_BASE_URL };
