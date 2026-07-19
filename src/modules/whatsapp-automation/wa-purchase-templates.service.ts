import { AppError } from "../../middleware/error.middleware";
import logger from "../../config/logger";
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

// Meta requires body variables to be numbered {{1}}, {{2}}, ... sequentially
// with no gaps or duplicates, and the example array (one value per unique
// variable) must line up. Catch malformed wording here so submission fails with
// a clear message instead of an opaque Meta rejection / later 132012 at send.
function validatePlaceholders(bodyText: string): void {
    const nums = (bodyText.match(/{{\d+}}/g) ?? []).map((m) => parseInt(m.replace(/[{}]/g, ""), 10));
    const unique = [...new Set(nums)].sort((a, b) => a - b);
    for (let i = 0; i < unique.length; i++) {
        if (unique[i] !== i + 1) {
            throw new AppError(
                400,
                `Message variables must be numbered {{1}}, {{2}}, ... with no gaps — found ${unique.map((n) => `{{${n}}}`).join(", ")}`,
                "VALIDATION_ERROR"
            );
        }
    }
}

// A getTemplateStatus call for a template that was deleted on Meta's side comes
// back as a 4xx ("does not exist" / unsupported get request). Detect that so
// sync can auto-reset the row to resubmittable instead of throwing forever.
function isMetaDeletedError(err: any): boolean {
    const status = err?.response?.status;
    const msg = String(err?.response?.data?.error?.message ?? "").toLowerCase();
    return status === 404 || status === 400 && (msg.includes("does not exist") || msg.includes("unsupported get request") || msg.includes("nonexisting"));
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
        validatePlaceholders(existing.body_text);

        // Meta template names are immutable and unique per WABA — mint a fresh
        // versioned name each submission so a REJECTED -> edit -> resubmit flow
        // (or a resubmit after the salon deleted the template on Meta) never
        // collides with the old name or Meta's 30-day deleted-name cooldown.
        const templateName = `${eventType}_${salonId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

        logger.info(`[WA-TRACE] template SUBMIT ${eventType} — salon=${salonId} name="${templateName}"`);

        try {
            const result = await submitBodyOnlyTemplate({
                salonId,
                name: templateName,
                category: existing.category,
                language: existing.language || "en",
                bodyText: existing.body_text,
            });
            logger.info(`[WA-TRACE] template SUBMIT OK ${eventType} — metaId=${result.metaTemplateId ?? "none"} status=${result.status}`);

            return whatsappAutomationRepository.markSubmitted(
                salonId,
                eventType,
                templateName,
                result.metaTemplateId,
                (result.status === "APPROVED" ? "APPROVED" : "PENDING")
            );
        } catch (err: any) {
            const code = err?.response?.data?.error?.code ?? "—";
            const msg = err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";
            logger.error(`[WA-TRACE] template SUBMIT FAILED ${eventType} — Meta [${code}] ${msg}`);
            throw err;
        }
    },

    // Put a template back into a clean, resubmittable state — used when its
    // Meta copy was deleted/rejected. Preserves the salon's wording.
    async resetForResubmission(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        return whatsappAutomationRepository.resetTemplateForResubmission(salonId, eventType);
    },

    async syncStatus(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        if (!existing.meta_template_id) return existing;

        try {
            const synced = await syncBodyOnlyTemplateStatus({ salonId, metaTemplateId: existing.meta_template_id });
            return whatsappAutomationRepository.updateSyncedStatus(salonId, eventType, synced.status, synced.rejectionReason);
        } catch (err: any) {
            // Template was deleted on Meta's side — surface it as resubmittable
            // rather than leaving a stale APPROVED row that keeps failing sends.
            if (isMetaDeletedError(err)) {
                return whatsappAutomationRepository.resetTemplateForResubmission(salonId, eventType);
            }
            throw err;
        }
    },
};
