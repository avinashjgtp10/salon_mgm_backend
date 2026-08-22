import { Sale, SaleItem } from "./sales.types";
import { salonsRepository } from "../salons/salons.repository";
import { branchesRepository } from "../branches/branches.repository";
import { staffRepository } from "../staff/staff.repository";
import { clientsRepository } from "../clients/clients.repository";
import { sendReceiptDocument } from "./receipt-whatsapp.service";
import { renderReceiptPdf } from "./receipt-pdf.service";
import logger from "../../config/logger";

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

// Fire-and-forget by design (matches sendReceiptDocument itself): never
// throws, never blocks the caller's sale. Sends the PDF as a WhatsApp
// document via the Meta Business Cloud API — requires the salon to have
// WhatsApp connected and only delivers within Meta's 24h messaging window.
export async function sendPurchaseReceipt(params: ReceiptContextParams): Promise<{ sent: boolean; reason?: string }> {
    try {
        const ctx = await gatherReceiptContext(params);
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
