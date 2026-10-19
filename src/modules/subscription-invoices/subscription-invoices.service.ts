import pool from "../../config/database";
import logger from "../../config/logger";
import { renderHtmlToPdf } from "../../config/puppeteer";
import { AppError } from "../../middleware/error.middleware";
import { emailService } from "../utils/email.service";
import { GST_PERCENT } from "../plan-pricing/plan-pricing.service";
import { buildInvoiceHtml, type InvoicePrintPayload } from "./invoice-html.template";
import { amountInWords, BILLING_CYCLE_LABEL, SELLER } from "./invoice-format";
import { subscriptionInvoicesRepository as repo, type InvoiceFilters } from "./subscription-invoices.repository";

const num = (v: unknown) => Number(v ?? 0);
const isoDate = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

async function inTransaction<T>(fn: (db: import("pg").PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

export const subscriptionInvoicesService = {
    async overview(filters: InvoiceFilters) {
        const [invoices, summary, unbilled] = await Promise.all([
            repo.list(filters),
            repo.summary(filters),
            repo.listUnbilled(),
        ]);
        return { invoices, summary, unbilled };
    },

    // For salon owners: their own invoices only.
    listForSalon(salonId: string) {
        return repo.list({ salonId, limit: 200 });
    },

    // "Generate bill" on a paid payment. Idempotent.
    async generateForPayment(paymentId: string, createdBy: string | null) {
        const result = await inTransaction((db) => repo.createFromPayment(db, paymentId, GST_PERCENT, createdBy));
        if (!result) {
            throw new AppError(409, "That payment isn't paid, or its salon hasn't been created yet, so it can't be billed.", "CANNOT_BILL");
        }
        if (result.created) this.emailInvoice(result.id).catch(() => undefined);
        return repo.findById(result.id);
    },

    // Called by the Razorpay webhook (inside its own transaction) right after a charge is recorded.
    async generateForPaymentTx(db: import("pg").PoolClient, paymentId: string) {
        return repo.createFromPayment(db, paymentId, GST_PERCENT, null);
    },

    // Called when onboarding attaches earlier payments to a freshly created salon.
    async billAllUnbilledForSalon(salonId: string) {
        const ids = await repo.unbilledPaymentIdsForSalon(salonId);
        for (const id of ids) {
            const r = await inTransaction((db) => repo.createFromPayment(db, id, GST_PERCENT, null));
            if (r?.created) this.emailInvoice(r.id).catch(() => undefined);
        }
        return ids.length;
    },

    // A bill for money received outside Razorpay (bank transfer / cash).
    async createManual(body: any, createdBy: string | null) {
        const subtotal = Number(body?.subtotal);
        if (!body?.salon_id || typeof body.salon_id !== "string") throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
        if (!Number.isFinite(subtotal) || subtotal <= 0 || subtotal > 100_000_000) {
            throw new AppError(400, "subtotal (the price before GST) must be a number greater than 0", "VALIDATION_ERROR");
        }
        const planName = String(body.plan_name ?? "").trim();
        if (!planName) throw new AppError(400, "plan_name is required", "VALIDATION_ERROR");
        const cycle = body.billing_cycle ? String(body.billing_cycle) : null;
        if (cycle && !["monthly", "quarterly", "yearly"].includes(cycle)) {
            throw new AppError(400, "billing_cycle must be monthly, quarterly or yearly", "VALIDATION_ERROR");
        }
        const dateOrNull = (v: unknown, name: string) => {
            if (v === undefined || v === null || v === "") return null;
            if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AppError(400, `${name} must be YYYY-MM-DD`, "VALIDATION_ERROR");
            return v;
        };
        const periodStart = dateOrNull(body.period_start, "period_start");
        const periodEnd = dateOrNull(body.period_end, "period_end");
        if (periodStart && periodEnd && periodEnd < periodStart) throw new AppError(400, "period_end must not be before period_start", "VALIDATION_ERROR");
        const issuedRaw = dateOrNull(body.issued_date, "issued_date");
        const issuedAt = issuedRaw ? new Date(`${issuedRaw}T00:00:00.000Z`) : new Date();
        if (!(await repo.salonExists(body.salon_id))) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const id = await inTransaction((db) => repo.createManual(db, {
            salonId: body.salon_id, planName, billingCycle: cycle, periodStart, periodEnd, subtotal, gstPercent: GST_PERCENT,
            paymentMode: String(body.payment_mode ?? "Bank Transfer").slice(0, 40),
            transactionId: body.transaction_id ? String(body.transaction_id).slice(0, 80) : null,
            issuedAt, createdBy,
        }));
        this.emailInvoice(id).catch(() => undefined);
        return repo.findById(id);
    },

    async remove(id: string) {
        const removed = await repo.remove(id);
        if (!removed) throw new AppError(404, "Invoice not found", "NOT_FOUND");
        logger.info("Subscription invoice deleted", { invoiceId: id, invoiceNo: removed.invoice_no });
        return { id: removed.id, invoice_no: removed.invoice_no, was_from_payment: Boolean(removed.payment_id) };
    },

    // Everything the PDF (and any on-screen preview) needs. `salonId` scopes it for a salon owner.
    async buildPrintPayload(id: string, salonId?: string): Promise<InvoicePrintPayload> {
        const inv = await repo.findById(id, salonId);
        if (!inv) throw new AppError(404, "Invoice not found", "NOT_FOUND");
        const salon = await repo.salonContact(inv.salon_id);
        const total = num(inv.total);
        return {
            invoice: {
                invoice_no: inv.invoice_no,
                issued_at: isoDate(inv.issued_at)!,
                plan_label: BILLING_CYCLE_LABEL[inv.billing_cycle] ?? inv.billing_cycle ?? "Subscription",
                plan_name: inv.plan_name,
                payment_mode: inv.payment_mode,
                transaction_id: inv.transaction_id,
                status: inv.status,
                subtotal: num(inv.subtotal),
                gst_percent: num(inv.gst_percent),
                gst_amount: num(inv.gst_amount),
                total,
                period_start: isoDate(inv.period_start),
                period_end: isoDate(inv.period_end),
            },
            customer: {
                salon_name: inv.salon_name,
                address: [salon?.address, salon?.address_line2, salon?.city, salon?.state, salon?.pincode].filter(Boolean).join(", ") || null,
                contact: salon?.phone ?? null,
                email: salon?.email ?? inv.owner_email ?? null,
            },
            seller: { ...SELLER },
            amount_in_words: amountInWords(total),
        };
    },

    async renderPdf(id: string, salonId?: string): Promise<{ pdf: Buffer; filename: string }> {
        const payload = await this.buildPrintPayload(id, salonId);
        const pdf = await renderHtmlToPdf(buildInvoiceHtml(payload), { format: "A4", printBackground: true });
        return { pdf, filename: `${payload.invoice.invoice_no.replace(/\//g, "-")}.pdf` };
    },

    // Best-effort: a mail hiccup or a missing owner email must never fail the bill itself, so callers never await it.
    async emailInvoice(id: string) {
        try {
            const inv = await repo.findById(id);
            if (!inv || inv.emailed_at) return;
            if (!inv.owner_email) { logger.warn("Invoice email skipped - salon has no owner email", { invoiceId: id }); return; }
            const { pdf, filename } = await this.renderPdf(id);
            await emailService.sendSubscriptionInvoiceEmail({
                to: inv.owner_email,
                salonName: inv.salon_name,
                invoiceNo: inv.invoice_no,
                planLabel: `${inv.plan_name ?? "Subscription"}${inv.billing_cycle ? ` (${inv.billing_cycle})` : ""}`,
                amount: num(inv.total),
                pdfBuffer: pdf,
                pdfFilename: filename,
            });
            await repo.markEmailed(id);
        } catch (err: any) {
            logger.error("Invoice email failed", { invoiceId: id, error: err?.message });
        }
    },

    // Used right after the webhook commits a charge.
    async emailForTransaction(transactionId: string) {
        const inv = await repo.findByTransactionId(transactionId);
        if (inv) await this.emailInvoice(inv.id);
    },
};
