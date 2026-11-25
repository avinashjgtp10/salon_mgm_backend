import { configRepository } from "../marketing/whatsapp/config/config.repository";
import { getPlatformSalonId } from "../client-announcements/platform-salon";
import { whatsappAutomationRepository } from "../whatsapp-automation/whatsapp-automation.repository";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { daysRemainingValue } from "../whatsapp-automation/wa-automation-defaults";

// The subscription expiry WhatsApp goes out from SalonOx's OWN Meta account (the platform salon's config, set up in
// Super Admin > Super Meta), using the 'subscription_expiring' template managed on Super Meta > Automated Messages
// (editable wording, submit to Meta, status — the same machinery as Message Settings). The owner may never have messaged
// that number, so only an APPROVED template can be sent.

export type ExpiryWhatsAppResult =
    | { sent: true }
    | { sent: false; skipped: "no_phone" | "platform_not_configured" | "template_pending" };

/**
 * Hands the expiry message to the automation sender. Returns a `skipped` reason when nothing can go out yet (the
 * caller retries on the next sweep). The send itself runs in the background with the automation module's own retries
 * and log row — same contract as every other automatic message.
 */
export async function sendExpiryWhatsApp(p: {
    ownerPhone?: string | null;
    ownerName?: string | null;
    salonName: string;
    planName: string;
    expiryDate: string;
    daysRemaining: number;
    referenceId: string;
}): Promise<ExpiryWhatsAppResult> {
    if (!p.ownerPhone || !p.ownerPhone.replace(/\D/g, "")) return { sent: false, skipped: "no_phone" };

    const platformSalonId = await getPlatformSalonId();
    const cfg = platformSalonId ? await configRepository.findBySalonId(platformSalonId) : null;
    if (!platformSalonId || !cfg?.phone_number_id || !cfg?.access_token) return { sent: false, skipped: "platform_not_configured" };

    const template = await whatsappAutomationRepository.findTemplate("subscription_expiring", platformSalonId);
    if (!template) return { sent: false, skipped: "template_pending" };

    // Positional, in EVENT_VARIABLE_NAMES.subscription_expiring order. The last one is the bare number or the whole phrase
    // depending on which wording is live on Meta (see daysRemainingValue).
    const variables: Record<string, string> = {
        "1": p.ownerName?.trim() || "there",
        "2": p.salonName,
        "3": p.planName,
        "4": p.expiryDate,
        "5": daysRemainingValue(template.body_text, p.daysRemaining),
    };
    void whatsappAutomationService
        .trigger({
            salonId: platformSalonId,
            eventType: "subscription_expiring",
            clientId: null,
            phone: p.ownerPhone,
            countryCode: null,
            variables,
            referenceId: p.referenceId,
            referenceType: "subscription",
            dedupeByReference: true,
            whatsappOnly: true,
        })
        .catch(() => undefined);
    return { sent: true };
}
