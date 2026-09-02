import { AppError } from "../../middleware/error.middleware";
import logger from "../../config/logger";
import { whatsappAutomationRepository } from "./whatsapp-automation.repository";
import { AutomationEventType, PURCHASE_EVENTS, CAPTION_ONLY_EVENTS } from "./whatsapp-automation.types";
import { isPurchaseEventType, validateNamedPlaceholders, toMetaNumberedBody, DefaultPurchaseEventType } from "./wa-automation-defaults";
import { submitBodyOnlyTemplate, syncBodyOnlyTemplateStatus } from "../marketing/whatsapp/shared/template-submission.helper";
import { submitBillReceiptTemplate } from "./wa-bill-receipt-template.helper";

function requirePurchaseEvent(eventType: string): AutomationEventType {
    if (!PURCHASE_EVENTS.includes(eventType as AutomationEventType)) {
        throw new AppError(400, `"${eventType}" is not a purchase-template event type`, "VALIDATION_ERROR");
    }
    return eventType as AutomationEventType;
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

    // Editable anytime, regardless of current status. When a live APPROVED
    // template already exists, the edit goes into pending_body_text instead
    // of the live body_text — the live template keeps sending, untouched,
    // until this edit is actually submitted and approved (see below).
    async updateWording(salonId: string, eventTypeRaw: string, bodyText: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        if (!bodyText || !bodyText.trim()) {
            throw new AppError(400, "Template wording cannot be empty", "VALIDATION_ERROR");
        }
        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        if (existing.status === "APPROVED") {
            return whatsappAutomationRepository.upsertPendingBodyText(salonId, eventType, bodyText.trim());
        }
        return whatsappAutomationRepository.upsertDraftTemplate(salonId, eventType, bodyText.trim());
    },

    // Resubmittable anytime, regardless of current status. When a live
    // APPROVED template already exists, this submits pending_body_text as a
    // freshly-named Meta template and tracks its progress in the pending_*
    // columns — the live template/body_text/meta_template_id are left
    // completely untouched, so trigger() keeps sending the live version the
    // whole time this new one is awaiting approval. Only once Meta approves
    // it does syncStatus() below promote it over the live version.
    async submitForApproval(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        if (!isPurchaseEventType(eventType)) throw new AppError(400, "Invalid purchase event type", "VALIDATION_ERROR");
        if (CAPTION_ONLY_EVENTS.includes(eventType)) {
            throw new AppError(400, "This message doesn't go through Meta approval — just save your wording", "NOT_SUBMITTABLE");
        }

        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        const isResubmission = existing.status === "APPROVED";

        if (!isResubmission && existing.status === "PENDING") {
            throw new AppError(400, "Template is already pending — no need to resubmit", "ALREADY_SUBMITTED");
        }
        if (isResubmission && existing.pending_status === "PENDING") {
            throw new AppError(400, "A resubmission is already pending — no need to resubmit again", "ALREADY_SUBMITTED");
        }

        const bodyText = isResubmission ? existing.pending_body_text : existing.body_text;
        if (!bodyText || !bodyText.trim()) {
            throw new AppError(400, isResubmission ? "Edit the wording before resubmitting" : "Add wording before submitting for approval", "VALIDATION_ERROR");
        }
        validateNamedPlaceholders(bodyText, eventType as DefaultPurchaseEventType);

        // Meta template names are immutable and unique per WABA — mint a fresh
        // versioned name each submission so a REJECTED -> edit -> resubmit flow
        // (or a resubmit after the salon deleted the template on Meta) never
        // collides with the old name or Meta's 30-day deleted-name cooldown.
        const templateName = `${eventType}_${salonId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

        logger.info(`[WA-TRACE] template SUBMIT ${eventType} — salon=${salonId} name="${templateName}"${isResubmission ? " (resubmission, live template unaffected)" : ""}`);

        // Meta's numbering conversion is identical either way — only which
        // submission function to call differs (bill_receipt needs a document
        // HEADER built from a sample PDF; every other event is body-only).
        const numberedBody = toMetaNumberedBody(bodyText, eventType as DefaultPurchaseEventType);

        try {
            const result = eventType === "bill_receipt"
                ? await submitBillReceiptTemplate({
                    salonId,
                    name: templateName,
                    category: existing.category,
                    language: existing.language || "en",
                    bodyText: numberedBody,
                })
                : await submitBodyOnlyTemplate({
                    salonId,
                    name: templateName,
                    category: existing.category,
                    language: existing.language || "en",
                    // The salon's stored wording uses friendly named placeholders
                    // ({{customer_name}}, ...) — Meta only accepts sequential
                    // {{1}}, {{2}}, ... so it's converted right here, transiently,
                    // never stored in that form.
                    bodyText: numberedBody,
                    button: existing.has_button && existing.button_text && existing.button_url_base
                        ? { text: existing.button_text, urlBase: existing.button_url_base }
                        : undefined,
                });
            logger.info(`[WA-TRACE] template SUBMIT OK ${eventType} — metaId=${result.metaTemplateId ?? "none"} status=${result.status}`);

            const finalStatus = result.status === "APPROVED" ? "APPROVED" : "PENDING";
            return isResubmission
                ? whatsappAutomationRepository.markPendingSubmitted(salonId, eventType, templateName, result.metaTemplateId, finalStatus)
                : whatsappAutomationRepository.markSubmitted(salonId, eventType, templateName, result.metaTemplateId, finalStatus);
        } catch (err: any) {
            const metaError = err?.response?.data?.error;
            const code = metaError?.code ?? "—";
            const subcode = metaError?.error_subcode ?? "—";
            const msg = metaError?.error_user_msg || metaError?.message || err?.message || "Unknown error";
            logger.error(`[WA-TRACE] template SUBMIT FAILED ${eventType} — Meta [${code}/${subcode}] ${msg}`, {
                fbtrace_id: metaError?.fbtrace_id,
                error_data: metaError?.error_data,
                bodyText: bodyText.slice(0, 500),
            });
            // Surface Meta's actual rejection reason to the caller instead of
            // the raw AxiosError, which the global error handler can't extract
            // anything useful from and reports as an opaque 500.
            throw new AppError(400, `Meta rejected this template: ${msg}`, "META_REJECTED", { code, subcode });
        }
    },

    // Put a template back into a clean, resubmittable state. When a live
    // APPROVED template exists, this only dismisses a rejected pending
    // resubmission (clearing pending_status/pending_template_name/
    // pending_meta_template_id, preserving pending_body_text) — the live
    // template was never touched and needs no reset of its own. Otherwise
    // (no live template yet) this is the original "Meta copy deleted/
    // rejected, start over" reset, preserving body_text.
    async resetForResubmission(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        if (existing.status === "APPROVED") {
            return whatsappAutomationRepository.resetPendingForResubmission(salonId, eventType);
        }
        return whatsappAutomationRepository.resetTemplateForResubmission(salonId, eventType);
    },

    async syncStatus(salonId: string, eventTypeRaw: string) {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        if (CAPTION_ONLY_EVENTS.includes(eventType)) {
            return whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        }
        const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);

        // A resubmission is in flight against an already-live template — check
        // the PENDING candidate's Meta status, never the live one's.
        if (existing.status === "APPROVED" && existing.pending_status === "PENDING" && existing.pending_meta_template_id) {
            try {
                const synced = await syncBodyOnlyTemplateStatus({ salonId, metaTemplateId: existing.pending_meta_template_id });
                if (synced.status === "APPROVED") {
                    return whatsappAutomationRepository.promotePendingTemplate(salonId, eventType);
                }
                return whatsappAutomationRepository.updatePendingSyncedStatus(salonId, eventType, synced.status, synced.rejectionReason);
            } catch (err: any) {
                // The in-flight candidate vanished on Meta's side — clear the
                // pending tracking; the live template is unaffected either way.
                if (isMetaDeletedError(err)) {
                    return whatsappAutomationRepository.resetPendingForResubmission(salonId, eventType);
                }
                throw err;
            }
        }

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
