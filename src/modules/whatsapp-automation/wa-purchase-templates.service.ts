import { AppError } from "../../middleware/error.middleware";
import { whatsappAutomationRepository } from "./whatsapp-automation.repository";
import { AutomationEventType, PURCHASE_EVENTS } from "./whatsapp-automation.types";
import { isPurchaseEventType } from "./wa-automation-defaults";
import { submitBodyOnlyTemplate, syncBodyOnlyTemplateStatus } from "../marketing/whatsapp/shared/template-submission.helper";

function requirePurchaseEvent(eventType: string): AutomationEventType {
    if (!PURCHASE_EVENTS.includes(eventType as AutomationEventType)) {
        throw new AppError(400, `"${eventType}" is not a purchase-template event type`, "VALIDATION_ERROR");
    }
    return eventType as AutomationEventType;
}

export const waPurchaseTemplatesService = {
    async list(salonId: string) {
        return whatsappAutomationRepository.findAllSalonPurchaseTemplates(salonId);
    },

    async updateWording(salonId: string, eventTypeRaw: string, bodyText: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        if (!bodyText || !bodyText.trim()) {
            throw new AppError(400, "Template wording cannot be empty", "VALIDATION_ERROR");
        }
        return whatsappAutomationRepository.upsertDraftTemplate(salonId, eventType, bodyText.trim());
    },

    async submitForApproval(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        if (!isPurchaseEventType(eventType)) throw new AppError(400, "Invalid purchase event type", "VALIDATION_ERROR");

        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        if (existing.status === "APPROVED" || existing.status === "PENDING") {
            throw new AppError(400, `Template is already ${existing.status.toLowerCase()} — no need to resubmit`, "ALREADY_SUBMITTED");
        }
        if (!existing.body_text || !existing.body_text.trim()) {
            throw new AppError(400, "Add wording before submitting for approval", "VALIDATION_ERROR");
        }

        // Meta template names are immutable and unique per WABA — mint a fresh
        // versioned name each submission so a REJECTED -> edit -> resubmit flow
        // never collides with the rejected name.
        const templateName = `${eventType}_${salonId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

        const result = await submitBodyOnlyTemplate({
            salonId,
            name: templateName,
            category: existing.category,
            language: existing.language || "en",
            bodyText: existing.body_text,
        });

        return whatsappAutomationRepository.markSubmitted(
            salonId,
            eventType,
            templateName,
            result.metaTemplateId,
            (result.status === "APPROVED" ? "APPROVED" : "PENDING")
        );
    },

    async syncStatus(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        if (!existing.meta_template_id) return existing;

        const synced = await syncBodyOnlyTemplateStatus({ salonId, metaTemplateId: existing.meta_template_id });
        return whatsappAutomationRepository.updateSyncedStatus(salonId, eventType, synced.status, synced.rejectionReason);
    },
};
