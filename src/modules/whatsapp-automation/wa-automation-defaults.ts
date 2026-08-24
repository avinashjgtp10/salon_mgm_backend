import { AutomationEventType } from "./whatsapp-automation.types";

// Predefined starting wording for the salon-owner-editable events (see
// PURCHASE_EVENTS in whatsapp-automation.types.ts) a salon can edit and submit
// to Meta for approval under their own WABA. {{1}}, {{2}}, {{3}}... are Meta
// template variable placeholders, numbered sequentially in order of first
// appearance and reused where a value repeats — filled in at send time from
// the same positions each trigger call site uses (see each trigger() call for
// the exact variable mapping).
//
// `bill_receipt` is the one exception: it's sent as a caption on the bill PDF
// document message, never submitted to Meta, so it uses named placeholders
// instead — {{customer_name}}, {{salon_name}}, {{items}}, {{feedback_link}} —
// substituted server-side in receipt-send.helper.ts. {{items}} is filled with
// a server-built itemized breakdown of the sale (service/product lines, plus
// "Package Used" / "Membership Used" lines when applicable) — there's no
// {{n}} numbering rule to satisfy since Meta never sees this text.
const FEEDBACK_FORM_BASE_URL =
    process.env.FRONTEND_URL || process.env.APP_BASE_URL || "http://localhost:5173";

export const DEFAULT_PURCHASE_TEMPLATES: Record<
    | "client_welcome" | "service_purchased" | "product_purchased" | "package_purchased"
    | "membership_purchased" | "bill_receipt" | "appointment_confirmation" | "appointment_rescheduled"
    | "appointment_cancelled" | "payment_received" | "package_expiring_7d" | "package_expiring_24h"
    | "membership_expiring_7d" | "membership_expiring_24h" | "package_session_used"
    | "membership_session_used" | "package_appointment_reminder_24h" | "service_reminder_24h"
    | "reward_points_earned" | "referral_reward",
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
        bodyText: "Hi {{1}}! 👋\nWelcome to {{2}}! ✨\nWe're happy to have you with us.\nThank you for choosing {{2}}!",
    },
    service_purchased: {
        label: "Service Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour payment of ₹{{2}} for {{3}} has been successfully received. ✅\nThank you for choosing {{4}}. 💜",
    },
    product_purchased: {
        label: "Product Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour payment of ₹{{2}} for {{3}} has been successfully received. ✅\nThank you for shopping with {{4}}! 💜",
    },
    package_purchased: {
        label: "Package Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 🎉\nYour {{2}} package has been successfully activated. ✅\nPackage Value: ₹{{3}}\nSessions: {{4}}\nValid Until: {{5}}\nThank you for choosing {{6}}! 💜",
    },
    membership_purchased: {
        label: "Membership Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 🎉\nWelcome to {{2}} at {{3}}! 💜\nMembership Value: ₹{{4}}\nAvailable Balance: ₹{{5}}\nValid Until: {{6}}\nThank you for choosing {{3}}! 💜",
    },
    bill_receipt: {
        label: "Bill Receipt (Thank You + Feedback)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{customer_name}}! 👋\nThank you for visiting {{salon_name}}. 💜\nWe hope you had a great experience!\n🧾 Your bill is attached with this message.\n{{items}}\nWe'd love to hear your feedback.\nShare your feedback here:\n{{feedback_link}}\nThank you for choosing {{salon_name}}! ✨",
    },
    appointment_confirmation: {
        label: "Appointment Confirmation",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour appointment at {{2}} is confirmed. ✅\n📅 Date: {{3}}\n⏰ Time: {{4}}\n💇 Service: {{5}}\n👤 Staff: {{6}}\nWe look forward to seeing you! 💜",
    },
    appointment_rescheduled: {
        label: "Appointment Rescheduled",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour appointment at {{2}} has been rescheduled. 🔄\nPrevious: {{3}} at {{4}}\nNew: {{5}} at {{6}}\n💇 Service: {{7}}\n👤 Staff: {{8}}\nWe look forward to seeing you! 💜",
    },
    appointment_cancelled: {
        label: "Appointment Cancelled",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}},\nYour appointment at {{2}} has been cancelled. ❌\n📅 Date: {{3}}\n⏰ Time: {{4}}\n💇 Service: {{5}}\nIf you'd like to book another appointment, we're happy to help. 💜",
    },
    payment_received: {
        label: "Payment Received (Appointment)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour payment of ₹{{2}} for your {{3}} appointment has been successfully received. ✅\n📅 Appointment: {{4}}\n⏰ Time: {{5}}\nThank you for choosing {{6}}! 💜",
    },
    package_expiring_7d: {
        label: "Package Expiring (7 Days)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour {{2}} is expiring in 7 days. ⏳\n📅 Expiry Date: {{3}}\n🎟️ Sessions Remaining: {{4}}\nDon't miss out on your remaining sessions! 💜\nBook your next visit today.",
    },
    package_expiring_24h: {
        label: "Package Expiring (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! ⚠️\nYour {{2}} expires tomorrow.\n🎟️ Sessions Remaining: {{3}}\n📅 Expiry Date: {{4}}\nYou still have time to use your remaining sessions. 💜\nBook your appointment now.",
    },
    membership_expiring_7d: {
        label: "Membership Expiring (7 Days)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour {{2}} membership expires in 7 days. ⏳\n📅 Expiry Date: {{3}}\n💰 Balance Remaining: ₹{{4}}\nMake the most of your remaining membership benefits before it expires. 💜",
    },
    membership_expiring_24h: {
        label: "Membership Expiring (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! ⚠️\nYour {{2}} membership expires tomorrow.\n💰 Remaining Balance: ₹{{3}}\n📅 Expiry Date: {{4}}\nDon't let your remaining membership balance go unused. 💜",
    },
    package_session_used: {
        label: "Package Session Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour {{2}} service has been successfully redeemed from your {{3}}. ✅\n🎟️ Session Used: 1\n🎟️ Sessions Remaining: {{4}}\nThank you for visiting {{5}}! 💜",
    },
    membership_session_used: {
        label: "Membership Session Used",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nYour {{2}} service has been successfully redeemed from your membership. ✅\n💰 Amount Used: ₹{{3}}\n💰 Remaining Balance: ₹{{4}}\nThank you for visiting {{5}}! 💜",
    },
    package_appointment_reminder_24h: {
        label: "Package Appointment Reminder (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nJust a reminder that you have an appointment tomorrow at {{2}}. ⏰\n📅 Date: {{3}}\n⏰ Time: {{4}}\n💇 Service: {{5}}\n🎟️ This appointment will use 1 session from your {{6}}.\nSee you tomorrow! 💜",
    },
    service_reminder_24h: {
        label: "Appointment Reminder (Tomorrow)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 👋\nThis is a reminder for your appointment tomorrow at {{2}}. ⏰\n📅 Date: {{3}}\n⏰ Time: {{4}}\n💇 Service: {{5}}\n👤 Staff: {{6}}\nWe look forward to seeing you tomorrow! 💜",
    },
    reward_points_earned: {
        label: "Reward Points Earned",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 🎉\nYou've earned {{2}} reward points from your recent visit to {{3}}. 💜\n⭐ Points Earned: {{2}}\n⭐ Total Points: {{4}}\nKeep visiting and earning rewards! ✨",
    },
    referral_reward: {
        label: "Referral Reward Credited",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}! 🎉\nGreat news! Your referral {{2}} has completed their qualifying visit at {{3}}. 💜\n🎁 Referral Reward: {{4}}\n⭐ Your Total Reward Points: {{5}}\nThank you for spreading the word! 🙌",
    },
};

export type DefaultPurchaseEventType = keyof typeof DEFAULT_PURCHASE_TEMPLATES;

export function isPurchaseEventType(eventType: AutomationEventType): eventType is DefaultPurchaseEventType {
    return eventType in DEFAULT_PURCHASE_TEMPLATES;
}

// bill_receipt's feedback link base — same mechanism the removed review_request
// event used, reused here since receipt-send.helper.ts builds the same kind of
// link (see generateFeedbackToken() in reviews/feedback-token.util.ts).
export { FEEDBACK_FORM_BASE_URL };
