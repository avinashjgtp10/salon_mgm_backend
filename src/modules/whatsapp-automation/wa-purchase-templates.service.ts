import { AppError } from "../../middleware/error.middleware";
import { v4 as uuid } from "uuid";
import logger from "../../config/logger";
import { whatsappAutomationRepository } from "./whatsapp-automation.repository";
import { whatsappAutomationService } from "./whatsapp-automation.service";
import { AutomationEventType, PURCHASE_EVENTS, CAPTION_ONLY_EVENTS } from "./whatsapp-automation.types";
import { isPurchaseEventType, validateNamedPlaceholders, toMetaNumberedBody, DefaultPurchaseEventType, EVENT_VARIABLE_NAMES } from "./wa-automation-defaults";
import { submitBodyOnlyTemplate, syncBodyOnlyTemplateStatus } from "../marketing/whatsapp/shared/template-submission.helper";
import { submitBillReceiptTemplate, sendBillReceiptTemplateMessage, buildSampleReceiptPdf } from "./wa-bill-receipt-template.helper";
import { salonsRepository } from "../salons/salons.repository";

// Same sample values the frontend preview uses (sampleValues.ts) — kept in
// sync manually since a test send just needs *something* realistic in each
// slot, not pixel parity with the preview panel's own rendering.
const TEST_SAMPLE_VALUES: Record<string, string> = {
    customer_name: "Priya Sharma", salon_name: "Bloom Salon",
    appointment_date: "12 Sep 2026", appointment_time: "3:30 PM",
    old_date: "10 Sep 2026", old_time: "2:00 PM", new_date: "12 Sep 2026", new_time: "3:30 PM",
    service_name: "Hair Cut", staff_name: "Anita", amount: "1,250",
    package_name: "Glow Package", membership_name: "Gold Membership", expiry_date: "30 Sep 2026",
    remaining_sessions: "3", remaining_balance: "1,500", remaining_services_breakdown: "Hair Cut-2, Facial-1",
    services: "Hair Cut, Facial", total_sessions: "5", package_value: "4,999", invoice_number: "INV-1024",
    benefit: "10% off every visit", start_date: "1 Sep 2026", membership_price: "6,999",
    items: "Hair Cut — 500, Facial — 750, Total Paid: 1,250",
    feedback_line: "We'd love your feedback: https://feedback.salonox.com/f/abc123",
    amount_used: "500", points_earned: "50", total_points: "320",
    referred_customer_name: "Rahul Verma", reward: "100", points_used: "50", remaining_points: "270",
    referral_code: "SAMPLE10", opening_date: "25 Sep 2026", opening_time: "9:00 AM", opening_amount: "500",
    closing_date: "25 Sep 2026", closing_time: "9:00 PM",
    collection_breakdown: "Cash: ₹500.00 | Card: ₹300.00 | UPI: ₹200.00",
    total_collection: "1,000", expenses: "100", in_store_cash: "400",
};

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

    // Called once, fire-and-forget, right after a salon finishes WhatsApp
    // setup for the first time — submits every PURCHASE_EVENTS template that's
    // still sitting untouched in DRAFT (its seeded default wording, never
    // edited or submitted) so a new salon's automation starts working without
    // requiring them to click "Submit to Meta" 24 separate times. Anything
    // already PENDING/APPROVED/REJECTED (they got to it first, or this ran
    // before and partially succeeded) is left completely alone. Each event is
    // submitted independently — one Meta rejection (e.g. a placeholder-count
    // mismatch in a default body) must never block the other 23.
    async submitAllDefaults(salonId: string): Promise<{ submitted: string[]; skipped: string[]; failed: Array<{ eventType: string; reason: string }> }> {
        const submitted: string[] = [];
        const skipped: string[] = [];
        const failed: Array<{ eventType: string; reason: string }> = [];

        for (const eventType of PURCHASE_EVENTS) {
            if (CAPTION_ONLY_EVENTS.includes(eventType)) { skipped.push(eventType); continue; }
            try {
                const existing = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
                if (existing.status !== "DRAFT" || !existing.body_text?.trim()) { skipped.push(eventType); continue; }
                await this.submitForApproval(salonId, eventType);
                submitted.push(eventType);
            } catch (err: any) {
                failed.push({ eventType, reason: err?.message ?? "Unknown error" });
                logger.warn(`[WA-TRACE] submitAllDefaults: ${eventType} failed for salon ${salonId} — ${err?.message}`);
            }
        }

        logger.info(`[WA-TRACE] submitAllDefaults for salon ${salonId}: ${submitted.length} submitted, ${skipped.length} skipped, ${failed.length} failed`);
        return { submitted, skipped, failed };
    },

    // "Send Test" — fires the salon's own LIVE approved template at an
    // arbitrary phone number with realistic sample values in every slot.
    // Meta only ever sends an APPROVED template, never draft/pending
    // wording, so this is a genuine constraint, not an arbitrary one: there
    // is no way to preview unapproved wording as a real WhatsApp message.
    //
    // trigger()'s own retry loop can sleep up to ~21 minutes across its 4
    // attempts on a failing send (sendWithRetry) — same reasoning as
    // cash-management.service.ts's resendClosedCounterMessage: fire it
    // without awaiting, then poll the fresh log row for a few seconds so a
    // normal (fast) success/failure still comes back in the response,
    // without blocking the request for a slow one.
    async sendTest(salonId: string, eventTypeRaw: string, phone: string): Promise<{ sent: boolean; status: string; failure_reason: string | null }> {
        const eventType = requirePurchaseEvent(eventTypeRaw);
        if (CAPTION_ONLY_EVENTS.includes(eventType)) {
            throw new AppError(400, "This message type doesn't go through Meta — nothing to test-send", "NOT_TESTABLE");
        }
        const tpl = await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType);
        if (tpl.status !== "APPROVED") {
            throw new AppError(400, "This template must be approved by Meta before you can send a test message", "TEMPLATE_NOT_APPROVED");
        }

        const names = isPurchaseEventType(eventType) ? EVENT_VARIABLE_NAMES[eventType] : undefined;
        const variables: Record<string, string> = {};
        (names ?? []).forEach((name, i) => { variables[String(i + 1)] = TEST_SAMPLE_VALUES[name] ?? `[${name}]`; });

        // bill_receipt's live template has a DOCUMENT header (the bill PDF) —
        // trigger()'s normal send path only ever supplies BODY parameters, so
        // sending it that way gets rejected by Meta (#132012, "parameter
        // format does not match... in the created template": the template
        // expects a header parameter that was never sent). Route this one
        // event through the same helper checkout uses, with the same fixture
        // PDF the submission-review flow already generates.
        if (eventType === "bill_receipt") {
            const salon = await salonsRepository.findById(salonId);
            const pdfBuffer = await buildSampleReceiptPdf(salon?.business_name ?? "our salon");
            const result = await sendBillReceiptTemplateMessage({
                salonId, phone, countryCode: null,
                templateName: tpl.template_name, language: tpl.language,
                pdfBuffer, pdfFilename: "sample-receipt.pdf",
                variables,
            });
            return { sent: result.sent, status: result.sent ? "SENT" : "FAILED", failure_reason: result.reason ?? null };
        }

        const referenceId = uuid();
        whatsappAutomationService.trigger({
            salonId, eventType, clientId: null, phone, countryCode: null, variables,
            referenceId, referenceType: "test_send", dedupeByReference: false,
        }).catch(() => {});

        const POLL_MS = 500;
        const MAX_WAIT_MS = 6000;
        for (let waited = 0; waited < MAX_WAIT_MS; waited += POLL_MS) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            const log = await whatsappAutomationRepository.findLatestByReference(referenceId, "test_send");
            if (log && log.status !== "QUEUED") {
                return { sent: log.status === "SENT", status: log.status, failure_reason: log.failure_reason ?? null };
            }
        }
        return { sent: false, status: "IN_PROGRESS", failure_reason: null };
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
            // Meta's Graph API error body isn't always JSON-shaped the way
            // metaError expects (e.g. a raw HTML error page, or a genuine
            // network-level failure with no response at all) — fall back to
            // the HTTP status/statusText instead of a bare "Unknown error" so
            // there's still something actionable without needing server logs.
            const msg = metaError?.error_user_msg || metaError?.message || err?.message
                || (err?.response?.status ? `HTTP ${err.response.status} ${err.response.statusText ?? ""}`.trim() : "Unknown error");
            logger.error(`[WA-TRACE] template SUBMIT FAILED ${eventType} — Meta [${code}/${subcode}] ${msg}`, {
                fbtrace_id: metaError?.fbtrace_id,
                error_data: metaError?.error_data,
                responseData: metaError ? undefined : err?.response?.data,
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
                    return whatsappAutomationRepository.promotePendingTemplate(salonId, eventType, undefined, undefined, synced.category);
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
            return whatsappAutomationRepository.updateSyncedStatus(salonId, eventType, synced.status, synced.rejectionReason, synced.category);
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
