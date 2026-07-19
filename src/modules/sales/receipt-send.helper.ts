import { Sale, SaleItem } from "./sales.types";
import { salonsRepository } from "../salons/salons.repository";
import { branchesRepository } from "../branches/branches.repository";
import { staffRepository } from "../staff/staff.repository";
import { clientsRepository } from "../clients/clients.repository";
import { sendReceiptDocument } from "./receipt-whatsapp.service";
import logger from "../../config/logger";

// Shared by every purchase-completion call site (sales, packages, memberships,
// appointments) — gathers the salon/branch/staff/client context the PDF
// receipt template needs, then sends it. Fire-and-forget by design (matches
// sendReceiptDocument itself): never throws, never blocks the caller's sale.
export async function sendPurchaseReceipt(params: {
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
}): Promise<void> {
    try {
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

        await sendReceiptDocument({
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
        });
    } catch (err: any) {
        // Best-effort — sendReceiptDocument already swallows its own errors;
        // this catches failures in the gathering step above (e.g. a bad salonId).
        logger.warn(`[WA-TRACE] PDF-BILL prep FAILED — sale=${params.sale?.id} salon=${params.salonId} — ${err?.message ?? err}`);
    }
}
