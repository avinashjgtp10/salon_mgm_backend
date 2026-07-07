import { AutomationEventType } from "./whatsapp-automation.types";

// Predefined starting wording for the salon-owner-editable events (the 4
// purchase events plus the Phase 2 lifecycle events) a salon can edit and
// submit to Meta for approval under their own WABA. {{1}}, {{2}}, {{3}} are
// Meta template variable placeholders — filled in at send time from the same
// positions the rest of whatsapp-automation.service.ts already uses
// (1 = client name, 2 = salon name / item name, 3 = item name / date / count,
// varies slightly per event — see each trigger call site for the exact mapping).
export const DEFAULT_PURCHASE_TEMPLATES: Record<
    | "service_purchased" | "product_purchased" | "membership_purchased" | "package_purchased"
    | "appointment_reminder_1h" | "thank_you" | "review_request" | "package_expiring_soon" | "sessions_remaining",
    { label: string; category: "UTILITY"; language: string; bodyText: string }
> = {
    service_purchased: {
        label: "Service Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, thank you for choosing {{2}}! Your {{3}} service is confirmed. We hope you enjoy your visit!",
    },
    product_purchased: {
        label: "Product Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, thank you for purchasing {{3}} from {{2}}! Your receipt is attached to this message.",
    },
    membership_purchased: {
        label: "Membership Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, your {{3}} membership at {{2}} is now active! Thank you for joining us.",
    },
    package_purchased: {
        label: "Package Purchased",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, your {{3}} package at {{2}} is now active! Thank you for your purchase.",
    },
    appointment_reminder_1h: {
        label: "Appointment Reminder (1 Hour Before)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, just a reminder that your appointment at {{2}} is coming up at {{3}}. See you soon!",
    },
    thank_you: {
        label: "Thank You",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, thank you for visiting {{2}} today! We hope you loved your experience.",
    },
    review_request: {
        label: "Review Request",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, we'd love your feedback on your recent visit to {{2}}! Please take a moment to leave us a review.",
    },
    package_expiring_soon: {
        label: "Package Expiring (7 Days)",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, your {{2}} package expires on {{3}}. Book your remaining sessions soon so they don't go to waste!",
    },
    sessions_remaining: {
        label: "Sessions Remaining",
        category: "UTILITY",
        language: "en",
        bodyText: "Hi {{1}}, you have {{3}} session(s) left in your {{2}}. Book your next visit soon!",
    },
};

export type DefaultPurchaseEventType = keyof typeof DEFAULT_PURCHASE_TEMPLATES;

export function isPurchaseEventType(eventType: AutomationEventType): eventType is DefaultPurchaseEventType {
    return eventType in DEFAULT_PURCHASE_TEMPLATES;
}
