import logger from "../../config/logger";
import { whatsappMetaApi } from "../marketing/whatsapp/shared/whatsapp.api";
import { configRepository } from "../marketing/whatsapp/config/config.repository";
import { formatPhone } from "../whatsapp-automation/whatsapp-automation.service";
import { generateAndSaveReceipt } from "./receipt-pdf.service";
import { Sale, SaleItem } from "./sales.types";

// Fire-and-forget: sends the PDF receipt as a WhatsApp document attachment.
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
}): Promise<void> {
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
            logger.info("[receipt] PUBLIC_BASE_URL not configured — skipping PDF receipt");
            return;
        }

        const salonConfig = await configRepository.findBySalonId(params.salonId);
        if (!salonConfig?.phone_number_id || !salonConfig?.access_token) {
            logger.info("[receipt] Salon has no WhatsApp configured — skipping PDF receipt");
            return;
        }

        const invoiceLabel = params.sale.invoice_number ?? params.sale.id.slice(0, 8).toUpperCase();

        await whatsappMetaApi.sendDocumentMessage({
            phoneNumberId: salonConfig.phone_number_id,
            accessToken: salonConfig.access_token,
            to: formatPhone(params.phone, params.countryCode),
            link: url,
            filename: `Receipt-${invoiceLabel}.pdf`,
        });
        logger.info("[receipt] PDF receipt sent", { saleId: params.sale.id });
    } catch (err: any) {
        logger.info("[receipt] PDF receipt send failed (expected outside 24h window)", {
            saleId: params.sale.id,
            error: err?.response?.data ?? err?.message,
        });
    }
}
