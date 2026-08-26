import axios from "axios";
import { AppError } from "../../middleware/error.middleware";
import { configRepository } from "../marketing/whatsapp/config/config.repository";
import { whatsappMetaApi } from "../marketing/whatsapp/shared/whatsapp.api";
import { salonsRepository } from "../salons/salons.repository";
import { renderReceiptPdf } from "../sales/receipt-pdf.service";
import { formatPhone } from "./whatsapp-automation.service";
import type { Sale, SaleItem } from "../sales/sales.types";

const WA_BASE_URL    = process.env.WA_BASE_URL    ?? "https://graph.facebook.com";
const WA_API_VERSION = process.env.WA_API_VERSION ?? "v22.0";

// bill_receipt is the one PURCHASE_EVENTS template with a document HEADER
// (the bill PDF), not just a text BODY — every other event goes through
// template-submission.helper.ts's body-only path. Kept as its own file
// (not a variant of that helper) so the resumable-upload plumbing needed
// only here can't regress the already-working body-only flow every other
// event depends on.

function extractExamples(text: string): string[] {
    const matches = text.match(/{{\d+}}/g) ?? [];
    const unique = [...new Set(matches.map((m) => parseInt(m.replace(/[{}]/g, ""), 10)))];
    return unique.sort((a, b) => a - b).map((n) => `Example${n}`);
}

// Meta requires a real file for a media-header template's review — there's
// no live bill yet at submission time, so this renders a representative
// sample invoice with fixture data purely for that review. Never sent to a
// real client; a real per-checkout PDF's URL is supplied fresh on every
// actual send (see sendBillReceiptTemplateMessage below).
async function buildSampleReceiptPdf(salonName: string): Promise<Buffer> {
    const now = new Date().toISOString();
    const sale: Sale = {
        id: "sample", salon_id: "sample", client_id: null, appointment_id: null, staff_id: null,
        status: "completed", subtotal: "500", discount_amount: "0", tip_amount: "0",
        tip_added_to_salon: false, tip_breakdown: null, tax_amount: "0", ex_charges: "0",
        total_amount: "500", payment_method: "cash", payment_reference: null, notes: null,
        invoice_number: "SAMPLE-001", created_by: null, created_at: now, updated_at: now,
        coupon_code: null, discount_percent: null, discount_type: null, manual_discount_amount: "0",
        coupon_id: null, coupon_discount_amount: "0", coupon_discount_type: null,
        referral_discount_amount: "0", referral_id: null, referral_source: null,
    };
    const items: SaleItem[] = [{
        id: "sample-item", sale_id: "sample", item_type: "service", item_id: null, staff_id: null,
        name: "Hair Cut", quantity: 1, discount_amount: "0", unit_price: "500", total_price: "500",
        tax_amount: "0", taxable_amount: "500", created_at: now,
    }];

    return renderReceiptPdf({
        salon: { business_name: salonName, logo_url: null, email: null, phone: null, website_url: null, gst_number: null },
        salonAddress: null,
        client: { name: "Sample Customer", phone: null, email: null },
        sale, items, staffNames: {}, appointment: null,
        paidAmount: 500, dueAmount: 0, couponCode: null,
    });
}

async function uploadHeaderHandle(pdfBuffer: Buffer, appId: string, accessToken: string): Promise<string> {
    const sessionRes = await axios.post(
        `${WA_BASE_URL}/${WA_API_VERSION}/${appId}/uploads`,
        null,
        { params: { file_length: pdfBuffer.length, file_type: "application/pdf", file_name: "sample-receipt.pdf", access_token: accessToken } }
    );
    const uploadSessionId = sessionRes.data.id;
    if (!uploadSessionId) throw new Error("No upload session ID returned from Meta");

    const uploadRes = await axios.post(
        `${WA_BASE_URL}/${WA_API_VERSION}/${uploadSessionId}`,
        pdfBuffer,
        { headers: { Authorization: `OAuth ${accessToken}`, file_offset: "0", "Content-Type": "application/pdf" } }
    );
    if (!uploadRes.data.h) throw new Error("No upload handle returned from Meta");
    return uploadRes.data.h;
}

export async function submitBillReceiptTemplate(params: {
    salonId: string;
    name: string;
    category: "UTILITY" | "MARKETING";
    language: string;
    bodyText: string;
}): Promise<{ metaTemplateId?: string; status: string }> {
    const config = await configRepository.findBySalonId(params.salonId);
    if (!config) throw new AppError(400, "WhatsApp not configured for this salon", "WA_NOT_CONFIGURED");
    const appId = (config as any).app_id;
    if (!appId) throw new AppError(400, "WhatsApp app_id not configured for this salon", "WA_NOT_CONFIGURED");

    const salon = await salonsRepository.findById(params.salonId);
    const samplePdf = await buildSampleReceiptPdf(salon?.business_name ?? "our salon");
    const handle = await uploadHeaderHandle(samplePdf, appId, config.access_token);

    const bodyExamples = extractExamples(params.bodyText);
    const bodyComponent: any = { type: "BODY", text: params.bodyText };
    if (bodyExamples.length > 0) bodyComponent.example = { body_text: [bodyExamples] };

    const components: any[] = [
        { type: "HEADER", format: "DOCUMENT", example: { header_handle: [handle] } },
        bodyComponent,
    ];

    const meta = await whatsappMetaApi.submitTemplate({
        wabaId: config.waba_id,
        accessToken: config.access_token,
        name: params.name,
        category: params.category,
        language: params.language,
        components,
    });

    return { metaTemplateId: meta.id, status: meta.status ?? "PENDING" };
}

// Sends an APPROVED bill_receipt template — the real per-checkout PDF is
// supplied as a link (already hosted by generateAndSaveReceipt for the same
// checkout), not re-uploaded; Meta fetches it directly at send time. This is
// the one difference from the campaign-template send path (whatsapp/queue/
// campaign.processor.ts), which reuses one static uploaded media id forever
// since a campaign's header file never changes between recipients — every
// bill_receipt send has a genuinely different PDF, so a fixed media id can't
// work here.
export async function sendBillReceiptTemplateMessage(params: {
    salonId: string;
    phone: string;
    countryCode?: string | null;
    templateName: string;
    language: string;
    pdfUrl: string;
    pdfFilename: string;
    variables: Record<string, string>;
}): Promise<{ sent: boolean; reason?: string }> {
    const config = await configRepository.findBySalonId(params.salonId);
    if (!config?.phone_number_id || !config?.access_token) {
        return { sent: false, reason: "WhatsApp isn't connected for this salon" };
    }

    const to = formatPhone(params.phone, params.countryCode);

    const components: any[] = [
        { type: "header", parameters: [{ type: "document", document: { link: params.pdfUrl, filename: params.pdfFilename } }] },
    ];
    const bodyParams = Object.values(params.variables).map((v) => ({ type: "text", text: String(v) }));
    if (bodyParams.length > 0) components.push({ type: "body", parameters: bodyParams });

    try {
        const result = await whatsappMetaApi.sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken: config.access_token,
            to,
            templateName: params.templateName,
            language: params.language,
            components,
        });
        const wamid = result?.messages?.[0]?.id;
        return wamid ? { sent: true } : { sent: false, reason: "No message id in Meta response" };
    } catch (err: any) {
        const msg = err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";
        return { sent: false, reason: msg };
    }
}
