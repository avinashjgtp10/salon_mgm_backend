import pool from "../../config/database";
import logger from "../../config/logger";
import { renderHtmlToPdf } from "../../config/puppeteer";
import { AppError } from "../../middleware/error.middleware";
import { emailService } from "../utils/email.service";
import { GST_PERCENT } from "../plan-pricing/plan-pricing.service";
import { buildInvoiceHtml, type InvoicePrintPayload } from "./invoice-html.template";
import { amountInWords, BILLING_CYCLE_LABEL, SELLER } from "./invoice-format";
import { subscriptionInvoicesRepository as repo, type InvoiceFilters } from "./subscription-invoices.repository";
import { PLATFORM_BILLING_CURRENCY, formatMoney } from "../../config/currency";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";

const BILLING_CYCLE_NAME: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", annual: "Yearly" };
const fmtDate = (v: unknown) =>
    v ? new Date(v as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "-";

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

    // A bill for money received outside Razorpay (bank transfer / cash). `with_gst: false` makes an invoice without GST:
    // 0% / ₹0 tax and the total equals the amount. Anything else (including leaving it out) is a GST invoice.
    async createManual(body: any, createdBy: string | null) {
        const withGst = body?.with_gst !== false && body?.with_gst !== "false";
        const subtotal = Number(body?.subtotal);
        if (!body?.salon_id || typeof body.salon_id !== "string") throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
        if (!Number.isFinite(subtotal) || subtotal <= 0 || subtotal > 100_000_000) {
            throw new AppError(400, "subtotal (the amount, before GST when GST is charged) must be a number greater than 0", "VALIDATION_ERROR");
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
            salonId: body.salon_id, planName, billingCycle: cycle, periodStart, periodEnd, subtotal, gstPercent: withGst ? GST_PERCENT : 0,
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
                currency: inv.currency ?? PLATFORM_BILLING_CURRENCY,
                subtotal: num(inv.subtotal),
                gst_percent: num(inv.gst_percent),
                gst_amount: num(inv.gst_amount),
                total,
                period_start: isoDate(inv.period_start),
                period_end: isoDate(inv.period_end),
                credit: num(inv.credit_amount),
                description: inv.description ?? null,
            },
            customer: {
                salon_name: inv.salon_name,
                address: [salon?.address, salon?.address_line2, salon?.city, salon?.state, salon?.pincode].filter(Boolean).join(", ") || null,
                contact: salon?.phone ?? null,
                email: salon?.email ?? inv.owner_email ?? null,
            },
            seller: { ...SELLER },
            // The words are in rupees, so they are only printed for INR invoices.
            amount_in_words: (inv.currency ?? PLATFORM_BILLING_CURRENCY) === PLATFORM_BILLING_CURRENCY ? amountInWords(total) : "",
        };
    },

    async renderPdf(id: string, salonId?: string): Promise<{ pdf: Buffer; filename: string }> {
        const payload = await this.buildPrintPayload(id, salonId);
        const pdf = await renderHtmlToPdf(buildInvoiceHtml(payload), { format: "A4", printBackground: true });
        return { pdf, filename: `${payload.invoice.invoice_no.replace(/\//g, "-")}.pdf` };
    },

    // The invoice PDF is rendered from the invoice row each time it is needed (email, download) and never stored on the server:
    // an invoice never changes after it is issued, so the result is the same every time.
    async ensurePdf(id: string): Promise<{ pdf: Buffer; filename: string }> {
        return this.renderPdf(id);
    },

    // Best-effort: a mail hiccup or a missing owner email must never fail the bill itself, so callers never await it.
    //
    // Safe to call any number of times for the same invoice (webhook retries, a reconcile, a restart):
    //  - the invoice exists once per payment (payment_id is unique), so a retry never creates a second one or a second PDF;
    //  - the send is claimed with one atomic UPDATE (emailed_at NULL -> now), so concurrent calls send at most one email;
    //  - if the send itself fails the claim is handed back, so the next call retries the email only.
    // A Razorpay-paid invoice gets the "Payment Successful" email with the GST invoice attached; a manual / granted-plan bill
    // (no Razorpay payment) keeps the plain invoice email. Voided invoices and unpaid payments are never emailed.
    async emailInvoice(id: string) {
        let claimed = false;
        try {
            const inv = await repo.findById(id);
            if (!inv || inv.status !== "paid") return;
            if (inv.emailed_at) return;
            if (!inv.owner_email) { logger.warn("Invoice email skipped - salon has no owner email", { invoiceId: id }); return; }

            const ctx = inv.payment_id ? await repo.paymentEmailContext(id) : null;
            if (inv.payment_id && ctx?.payment_status !== "paid") {
                logger.warn("Invoice email skipped - the payment is not confirmed as paid", { invoiceId: id });
                return;
            }

            claimed = await repo.claimEmail(id);
            if (!claimed) return;   // someone else already sent it

            // Rendered only now that an email is really going out (nothing is stored); a failure here hands the claim back below.
            const { pdf, filename } = await this.ensurePdf(id);

            if (ctx) {
                const currency = inv.currency ?? PLATFORM_BILLING_CURRENCY;
                const common = {
                    to: inv.owner_email,
                    ownerName: ctx.owner_first_name || ctx.owner_name,
                    salonName: inv.salon_name,
                    planName: inv.plan_name ?? "Subscription",
                    amount: formatMoney(num(inv.total), currency),
                    paymentId: inv.transaction_id ?? "-",
                    paymentDate: fmtDate(ctx.paid_at ?? inv.issued_at),
                    pdfBuffer: pdf,
                    pdfFilename: filename,
                };
                if (ctx.onboarding_completed) {
                    await emailService.sendPaymentSuccessEmail({
                        ...common,
                        billingCycle: BILLING_CYCLE_NAME[inv.billing_cycle] ?? inv.billing_cycle ?? "-",
                        startDate: fmtDate(inv.period_start),
                        endDate: fmtDate(inv.period_end),
                    });
                } else {
                    // Paid right after sign-up: confirm the payment and send them back to finish onboarding.
                    await emailService.sendPaymentReceivedOnboardingPendingEmail(common);
                }
            } else {
                await emailService.sendSubscriptionInvoiceEmail({
                    to: inv.owner_email,
                    salonName: inv.salon_name,
                    invoiceNo: inv.invoice_no,
                    planLabel: `${inv.plan_name ?? "Subscription"}${inv.billing_cycle ? ` (${inv.billing_cycle})` : ""}`,
                    amount: num(inv.total),
                    currency: inv.currency ?? PLATFORM_BILLING_CURRENCY,
                    pdfBuffer: pdf,
                    pdfFilename: filename,
                });
            }
        } catch (err: any) {
            if (claimed) await repo.releaseEmailClaim(id).catch(() => undefined);
            logger.error("Invoice email failed", { invoiceId: id, error: err?.message });
        }
    },

    // Used right after the webhook commits a charge.
    async emailForTransaction(transactionId: string) {
        const inv = await repo.findByTransactionId(transactionId);
        if (inv) { await this.emailInvoice(inv.id); return; }
        await this.emailPaymentReceived(transactionId);
    },

    // A payment made before the salon exists (right after sign-up) has no invoice yet, so there is no PDF to attach. Confirm the
    // payment straight away; the invoice PDF follows by email once onboarding creates the salon and the payment is billed.
    // Best-effort, like the invoice email.
    async emailPaymentReceived(transactionId: string) {
        try {
            const { rows } = await pool.query(
                `SELECT p.amount::float8 AS amount, ${(await billingSchemaReady()) ? "p.currency" : "'INR'::text"} AS currency,
                        sp.name AS plan_name, sp.billing_cycle, u.email, u.first_name
                 FROM subscription_payments p
                 JOIN subscriptions s ON s.id = p.subscription_id
                 LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
                 LEFT JOIN users u ON u.id = s.user_id
                 WHERE p.transaction_id = $1 AND p.payment_status = 'paid' AND s.salon_id IS NULL`,
                [transactionId]
            );
            const p = rows[0];
            if (!p?.email) return;
            await emailService.sendSubscriptionPaymentReceivedEmail({
                to: p.email,
                name: p.first_name || "there",
                planLabel: `${p.plan_name ?? "Subscription"}${p.billing_cycle ? ` (${p.billing_cycle})` : ""}`,
                amount: num(p.amount),
                currency: p.currency ?? PLATFORM_BILLING_CURRENCY,
                transactionId,
            });
        } catch (err: any) {
            logger.error("Payment received email failed", { transactionId, error: err?.message });
        }
    },
};
