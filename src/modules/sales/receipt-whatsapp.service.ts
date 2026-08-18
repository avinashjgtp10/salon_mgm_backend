import logger from "../../config/logger";
import { whatsappMetaApi } from "../marketing/whatsapp/shared/whatsapp.api";
import { configRepository } from "../marketing/whatsapp/config/config.repository";
import { formatPhone } from "../whatsapp-automation/whatsapp-automation.service";
import { generateAndSaveReceipt } from "./receipt-pdf.service";
import { Sale, SaleItem } from "./sales.types";

// Sends the PDF receipt as a WhatsApp document attachment. Never throws —
// every call site (including the fire-and-forget ones right after payment
// completion) relies on that — but now reports back whether it actually
// went out, so an on-demand "Send to WhatsApp" trigger (appointments
// .sendReceiptWhatsApp) can tell the user it failed instead of silently
// swallowing it like the automatic post-payment sends always have.
// This is a freeform message, only deliverable within 24h of the customer's
// last inbound message — a failure here (e.g. outside that window, no
// pre-approved media template) is expected and must never block payment
// completion or the existing text "payment_received" confirmation.
export async function sendReceiptDocument(params: {
    salonId: string;
    phone: string;
    countryCode?: string | null;
    salon: {
        business_name: string;
        logo_url: string | null;
        email: string | null;
        phone: string | null;
        website_url: string | null;
        gst_number: string | null;
    };
    salonAddress: string | null;
    client: { name: string; phone: string | null; email: string | null };
    sale: Sale;
    items: SaleItem[];
    staffNames: Record<string, string>;
    appointment: {
        id: string;
        scheduledAt: string;
        durationMinutes: number;
        status: string;
        notes: string | null;
    } | null;
    paidAmount: number;
    dueAmount: number;
    couponCode: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
    const to = formatPhone(params.phone, params.countryCode);
    logger.info(`[WA-TRACE] PDF-BILL START — sale=${params.sale.id} salon=${params.salonId} to=${to}`);
    try {
        const url = await generateAndSaveReceipt({
            salon: params.salon,
            salonAddress: params.salonAddress,
            client: params.client,
            sale: params.sale,
            items: params.items,
            staffNames: params.staffNames,
            appointment: params.appointment,
            paidAmount: params.paidAmount,
            dueAmount: params.dueAmount,
            couponCode: params.couponCode,
        });
        if (!url) {
            const reason = "WhatsApp receipt delivery isn't configured for this salon yet";
            logger.info(`[WA-TRACE] PDF-BILL SKIP — PUBLIC_BASE_URL not configured (PDF can't be hosted for Meta to fetch)`);
            return { sent: false, reason };
        }
        logger.info(`[WA-TRACE] PDF-BILL generated — url=${url}`);

        const salonConfig = await configRepository.findBySalonId(params.salonId);
        if (!salonConfig?.phone_number_id || !salonConfig?.access_token) {
            const reason = "WhatsApp isn't connected for this salon";
            logger.info(`[WA-TRACE] PDF-BILL SKIP — salon ${params.salonId} has no WhatsApp config`);
            return { sent: false, reason };
        }

        const invoiceLabel = params.sale.invoice_number ?? params.sale.id.slice(0, 8).toUpperCase();

        await whatsappMetaApi.sendDocumentMessage({
            phoneNumberId: salonConfig.phone_number_id,
            accessToken: salonConfig.access_token,
            to,
            link: url,
            filename: `Receipt-${invoiceLabel}.pdf`,
        });
        logger.info(`[WA-TRACE] PDF-BILL ✅ SENT — sale=${params.sale.id} to=${to}`);
        return { sent: true };
    } catch (err: any) {
        const code = err?.response?.data?.error?.code ?? "—";
        const msg = err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";
        // A failure here is often expected (document messages only deliver within
        // Meta's 24h service window) — logged as a warning, never fatal.
        logger.warn(`[WA-TRACE] PDF-BILL ❌ FAILED — sale=${params.sale.id} to=${to} — Meta [${code}] ${msg} (note: document messages only deliver within 24h of the customer's last message)`);
        // Meta's own error message is too technical to show a salon owner —
        // the 24h-window rejection is by far the most common real-world cause.
        const reason = code === 131047 || /24.?hour/i.test(msg)
            ? "This client hasn't messaged you on WhatsApp in the last 24 hours, so WhatsApp won't deliver a file to them yet — ask them to send you a message first, then try again."
            : "Failed to send the receipt via WhatsApp";
        return { sent: false, reason };
    }
}
