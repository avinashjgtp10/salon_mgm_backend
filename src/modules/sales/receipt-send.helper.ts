import { Sale, SaleItem } from "./sales.types";
import { salonsRepository } from "../salons/salons.repository";
import { branchesRepository } from "../branches/branches.repository";
import { staffRepository } from "../staff/staff.repository";
import { clientsRepository } from "../clients/clients.repository";
import { sendReceiptDocument } from "./receipt-whatsapp.service";
import { renderReceiptPdf, generateAndSaveReceipt } from "./receipt-pdf.service";
import { whatsappAutomationRepository } from "../whatsapp-automation/whatsapp-automation.repository";
import { sendBillReceiptTemplateMessage } from "../whatsapp-automation/wa-bill-receipt-template.helper";
import { generateFeedbackToken } from "../reviews/feedback-token.util";
import logger from "../../config/logger";

// Only buildable when this bill is tied to a real appointment, since the
// public feedback form is built entirely around an appointment's service
// list (see reviews.service.ts). A true walk-in Quick Sale has nothing to
// attach a feedback link to — gets a fallback line instead (see below).
function buildFeedbackLink(appointmentId: string): string {
    return `${process.env.FRONTEND_URL || process.env.APP_BASE_URL || "http://localhost:5173"}/feedback/${appointmentId}.${generateFeedbackToken(appointmentId)}`;
}

// Meta rejects a newline character inside a single template parameter's
// value (error 132018, "issue with the parameters in your template") — this
// has to render as one flat line, unlike a freeform caption which allows
// multi-line text freely.
function buildItemsBlock(items: SaleItem[], paidAmount: number, dueAmount: number): string {
    const lines = items.map((i) => `${i.name} — ₹${Number(i.total_price).toFixed(0)}`);
    lines.push(`Total Paid: ₹${paidAmount.toFixed(0)}`);
    if (dueAmount > 0) lines.push(`Due: ₹${dueAmount.toFixed(0)}`);
    return lines.join(", ");
}

type ReceiptContextParams = {
    salonId: string;
    phone: string;
    countryCode?: string | null;
    clientId: string | null;
    clientName: string;
    sale: Sale;
    items: SaleItem[];
    appointment?: {
        id: string;
        scheduledAt: string;
        durationMinutes: number;
        status: string;
        notes: string | null;
    } | null;
    paidAmount: number;
    dueAmount?: number;
    couponCode?: string | null;
};

// Shared by every purchase-completion call site (sales, packages, memberships,
// appointments) — gathers the salon/branch/staff/client context the PDF
// receipt template needs. Used by both the Meta-document send and the raw-
// bytes generator below, so every path renders an identical receipt.
async function gatherReceiptContext(params: ReceiptContextParams) {
    const [salonRecord, branches, staffList, clientRecord] = await Promise.all([
        salonsRepository.findById(params.salonId),
        branchesRepository.listBySalonId(params.salonId),
        staffRepository.list(params.salonId, { limit: 100, is_active: true } as any),
        params.clientId ? clientsRepository.findById(params.clientId, params.salonId) : Promise.resolve(null),
    ]);

    const branch = branches.find((b: any) => b.is_main) ?? branches[0] ?? null;
    const salonAddress = branch
        ? [branch.address_line1, branch.address_line2, branch.city, branch.state, branch.pincode].filter(Boolean).join(", ")
        : null;

    const staffNames: Record<string, string> = {};
    for (const s of (staffList as any).data as any[]) {
        staffNames[s.id] = [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email;
    }

    return {
        salonId: params.salonId,
        phone: params.phone,
        countryCode: params.countryCode ?? null,
        salon: {
            business_name: salonRecord?.business_name ?? "our salon",
            logo_url: (salonRecord as any)?.logo_url ?? null,
            email: salonRecord?.email ?? null,
            phone: salonRecord?.phone ?? null,
            website_url: salonRecord?.website_url ?? null,
            gst_number: salonRecord?.gst_number ?? null,
        },
        salonAddress,
        client: {
            name: clientRecord?.full_name ?? params.clientName,
            phone: clientRecord?.phone_number ?? params.phone,
            email: clientRecord?.email ?? null,
        },
        sale: params.sale,
        items: params.items,
        staffNames,
        appointment: params.appointment ?? null,
        paidAmount: params.paidAmount,
        dueAmount: params.dueAmount ?? 0,
        couponCode: params.couponCode ?? null,
    };
}

// Fire-and-forget by design: never throws, never blocks the caller's sale.
// bill_receipt is a real Meta document-header template — sent whenever the
// salon has an APPROVED copy (guaranteed delivery, no 24h-window limit).
// Otherwise falls back to the original plain PDF-only freeform send (works
// only within Meta's 24h customer-session window), same as before bill_receipt
// existed as a trigger — so a salon still mid-approval isn't left with nothing.
export async function sendPurchaseReceipt(params: ReceiptContextParams): Promise<{ sent: boolean; reason?: string }> {
    try {
        const ctx = await gatherReceiptContext(params);
        const billTemplate = await whatsappAutomationRepository.findTemplate("bill_receipt", params.salonId);

        if (billTemplate) {
            const pdfUrl = await generateAndSaveReceipt(ctx);
            if (!pdfUrl) {
                logger.warn(`[WA-TRACE] bill_receipt SKIP — PUBLIC_BASE_URL not configured (PDF can't be hosted for Meta to fetch)`);
                return { sent: false, reason: "WhatsApp receipt delivery isn't configured for this salon yet" };
            }

            const appointmentId = params.appointment?.id ?? null;
            const feedbackLine = appointmentId
                ? `We'd love to hear your feedback: ${buildFeedbackLink(appointmentId)}`
                : "We'd love to hear your feedback — just reply to this message!";
            const invoiceLabel = ctx.sale.invoice_number ?? ctx.sale.id.slice(0, 8).toUpperCase();

            return await sendBillReceiptTemplateMessage({
                salonId:      params.salonId,
                phone:        params.phone,
                countryCode:  params.countryCode,
                templateName: billTemplate.template_name,
                language:     billTemplate.language,
                pdfUrl,
                pdfFilename:  `Receipt-${invoiceLabel}.pdf`,
                variables: {
                    "1": ctx.client.name,
                    "2": ctx.salon.business_name,
                    "3": buildItemsBlock(params.items, params.paidAmount, params.dueAmount ?? 0),
                    "4": feedbackLine,
                },
            });
        }

        logger.info(`[WA-TRACE] bill_receipt not yet APPROVED for salon=${params.salonId} — falling back to plain PDF`);
        return await sendReceiptDocument(ctx);
    } catch (err: any) {
        // Best-effort — sendReceiptDocument already swallows its own errors;
        // this catches failures in the gathering step above (e.g. a bad salonId).
        logger.warn(`[WA-TRACE] PDF-BILL prep FAILED — sale=${params.sale?.id} salon=${params.salonId} — ${err?.message ?? err}`);
        return { sent: false, reason: "Failed to prepare the receipt" };
    }
}

// No Meta API and no PUBLIC_BASE_URL/hosting involved — just renders the same
// PDF and hands back the raw bytes, for an authenticated endpoint the salon
// owner's own browser downloads directly (then shares it locally via the
// device's native share sheet or a manual WhatsApp attach). Throws on
// failure — callers need real bytes, there's no partial-success case worth
// swallowing the way the fire-and-forget Meta send above does.
export async function getPurchaseReceiptPdf(params: ReceiptContextParams): Promise<{ buffer: Buffer; filename: string }> {
    const ctx = await gatherReceiptContext(params);
    const buffer = await renderReceiptPdf(ctx);
    const invoiceLabel = ctx.sale.invoice_number ?? ctx.sale.id.slice(0, 8).toUpperCase();
    return { buffer, filename: `Receipt-${invoiceLabel}.pdf` };
}
