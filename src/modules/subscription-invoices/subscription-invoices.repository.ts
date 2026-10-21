import type { PoolClient } from "pg";
import pool from "../../config/database";
import { financialYearCode, round2 } from "./invoice-format";

// Rows always reach callers with the salon's name/owner joined in (the list and the PDF both need them).
const SELECT_INVOICE = `
    SELECT i.id, i.invoice_no, i.salon_id, i.subscription_id, i.payment_id, i.plan_name, i.billing_cycle,
           i.period_start, i.period_end, i.subtotal, i.gst_percent, i.gst_amount, i.total,
           i.payment_mode, i.transaction_id, i.status, i.issued_at, i.emailed_at, i.created_at,
           i.kind, i.credit_amount, i.upgrade_id, i.description,
           COALESCE(sa.business_name, sa.slug, 'Unnamed') AS salon_name,
           ou.email AS owner_email,
           TRIM(CONCAT(ou.first_name, ' ', COALESCE(ou.last_name, ''))) AS owner_name
    FROM subscription_invoices i
    JOIN salons sa ON sa.id = i.salon_id
    LEFT JOIN users ou ON ou.id = sa.owner_id`;

export interface InvoiceFilters {
    q?: string;
    status?: "paid" | "void";
    from?: string;   // YYYY-MM-DD, inclusive
    to?: string;     // YYYY-MM-DD, inclusive
    salonId?: string;
    limit?: number;
    offset?: number;
}

function filterSql(f: InvoiceFilters) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.q?.trim()) {
        params.push(`%${f.q.trim()}%`);
        const n = params.length;
        where.push(`(i.invoice_no ILIKE $${n} OR COALESCE(sa.business_name, sa.slug, '') ILIKE $${n} OR ou.email ILIKE $${n})`);
    }
    if (f.status) { params.push(f.status); where.push(`i.status = $${params.length}`); }
    if (f.salonId) { params.push(f.salonId); where.push(`i.salon_id = $${params.length}`); }
    if (f.from) { params.push(f.from); where.push(`i.issued_at >= $${params.length}::date`); }
    if (f.to) { params.push(f.to); where.push(`i.issued_at < ($${params.length}::date + INTERVAL '1 day')`); }
    return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

type Db = Pick<PoolClient, "query">;

async function nextInvoiceNo(db: Db, issued: Date): Promise<string> {
    const { rows } = await db.query(`SELECT nextval('subscription_invoice_no_seq') AS seq`);
    return `FY${financialYearCode(issued)}/${String(Number(rows[0].seq)).padStart(2, "0")}`;
}

export const subscriptionInvoicesRepository = {
    async list(f: InvoiceFilters) {
        const { clause, params } = filterSql(f);
        const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
        const offset = Math.max(f.offset ?? 0, 0);
        const { rows } = await pool.query(
            `${SELECT_INVOICE} ${clause} ORDER BY i.issued_at DESC, i.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params
        );
        return rows;
    },

    async summary(f: InvoiceFilters) {
        const { clause, params } = filterSql(f);
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int                                              AS total_invoices,
                    COUNT(*) FILTER (WHERE i.status = 'paid')::int             AS paid_count,
                    COUNT(*) FILTER (WHERE i.status = 'void')::int             AS void_count,
                    COALESCE(SUM(i.total)      FILTER (WHERE i.status = 'paid'), 0)::float8 AS revenue,
                    COALESCE(SUM(i.gst_amount) FILTER (WHERE i.status = 'paid'), 0)::float8 AS gst_collected
             FROM subscription_invoices i
             JOIN salons sa ON sa.id = i.salon_id
             LEFT JOIN users ou ON ou.id = sa.owner_id
             ${clause}`,
            params
        );
        return rows[0];
    },

    async findById(id: string, salonId?: string) {
        const { rows } = await pool.query(
            `${SELECT_INVOICE} WHERE i.id = $1 ${salonId ? "AND i.salon_id = $2" : ""}`,
            salonId ? [id, salonId] : [id]
        );
        return rows[0] ?? null;
    },

    async findByPaymentId(paymentId: string) {
        const { rows } = await pool.query(`${SELECT_INVOICE} WHERE i.payment_id = $1`, [paymentId]);
        return rows[0] ?? null;
    },

    async findByTransactionId(transactionId: string) {
        const { rows } = await pool.query(`${SELECT_INVOICE} WHERE i.transaction_id = $1 LIMIT 1`, [transactionId]);
        return rows[0] ?? null;
    },

    // Salon contact block printed under "Bill To".
    async salonContact(salonId: string) {
        const { rows } = await pool.query(
            `SELECT business_name, address, address_line2, city, state, pincode, phone, email FROM salons WHERE id = $1`,
            [salonId]
        );
        return rows[0] ?? null;
    },

    // Paid payments that have no invoice yet (salon exists) - the "awaiting bill" list.
    async listUnbilled() {
        const { rows } = await pool.query(
            `SELECT p.id AS payment_id, p.amount::float8 AS amount, p.payment_method, p.transaction_id, p.paid_at,
                    s.salon_id, COALESCE(sa.business_name, sa.slug, 'Unnamed') AS salon_name,
                    sp.name AS plan_name, sp.billing_cycle
             FROM subscription_payments p
             JOIN subscriptions s ON s.id = p.subscription_id
             JOIN salons sa ON sa.id = s.salon_id
             LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
             WHERE p.payment_status = 'paid'
               AND NOT EXISTS (SELECT 1 FROM subscription_invoices i WHERE i.payment_id = p.id)
             ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC`
        );
        return rows;
    },

    async unbilledPaymentIdsForSalon(salonId: string): Promise<string[]> {
        const { rows } = await pool.query(
            `SELECT p.id FROM subscription_payments p
             JOIN subscriptions s ON s.id = p.subscription_id
             WHERE s.salon_id = $1 AND p.payment_status = 'paid'
               AND NOT EXISTS (SELECT 1 FROM subscription_invoices i WHERE i.payment_id = p.id)`,
            [salonId]
        );
        return rows.map((r) => r.id as string);
    },

    // One invoice for one paid payment. Idempotent: an advisory lock on the payment id plus the existence check means a
    // webhook retry or a double click returns the existing invoice instead of issuing (and numbering) a second one.
    // Must run inside a transaction (the lock is transaction-scoped).
    async createFromPayment(db: Db, paymentId: string, gstPercent: number, createdBy: string | null) {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sub-invoice:${paymentId}`]);

        const existing = await db.query(`SELECT id FROM subscription_invoices WHERE payment_id = $1`, [paymentId]);
        if (existing.rows[0]) return { id: existing.rows[0].id as string, created: false };

        const { rows } = await db.query(
            `SELECT p.amount::float8 AS amount, p.payment_method, p.transaction_id, p.paid_at,
                    p.billing_period_start, p.billing_period_end,
                    s.id AS subscription_id, s.salon_id, s.current_period_start, s.current_period_end,
                    sp.name AS plan_name, sp.billing_cycle
             FROM subscription_payments p
             JOIN subscriptions s ON s.id = p.subscription_id
             LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
             WHERE p.id = $1 AND p.payment_status = 'paid'`,
            [paymentId]
        );
        const p = rows[0];
        if (!p || !p.salon_id) return null;   // not paid, or the salon doesn't exist yet (billed once it is attached)

        // The payment is what the salon actually paid, GST included: split it back into price + GST.
        const total = round2(Number(p.amount));
        const subtotal = round2((total * 100) / (100 + gstPercent));
        const gst = round2(total - subtotal);
        const issued = p.paid_at ? new Date(p.paid_at) : new Date();
        const invoiceNo = await nextInvoiceNo(db, issued);

        const ins = await db.query(
            `INSERT INTO subscription_invoices
                (invoice_no, salon_id, subscription_id, payment_id, plan_name, billing_cycle, period_start, period_end,
                 subtotal, gst_percent, gst_amount, total, payment_mode, transaction_id, status, issued_at, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'paid',$15,$16)
             RETURNING id`,
            [
                invoiceNo, p.salon_id, p.subscription_id, paymentId, p.plan_name, p.billing_cycle,
                p.billing_period_start ?? p.current_period_start ?? null, p.billing_period_end ?? p.current_period_end ?? null,
                subtotal, gstPercent, gst, total, p.payment_method ? String(p.payment_method).toUpperCase() : "RAZORPAY",
                p.transaction_id ?? null, issued.toISOString(), createdBy,
            ]
        );
        return { id: ins.rows[0].id as string, created: true };
    },

    // A bill for money received outside Razorpay (bank transfer / cash): no payment row, `subtotal` is the price before GST.
    async createManual(db: Db, input: {
        salonId: string; planName: string; billingCycle: string | null; periodStart: string | null; periodEnd: string | null;
        subtotal: number; gstPercent: number; paymentMode: string; transactionId: string | null; issuedAt: Date; createdBy: string | null;
    }) {
        const subtotal = round2(input.subtotal);
        const gst = round2((subtotal * input.gstPercent) / 100);
        const total = round2(subtotal + gst);
        const invoiceNo = await nextInvoiceNo(db, input.issuedAt);
        const ins = await db.query(
            `INSERT INTO subscription_invoices
                (invoice_no, salon_id, plan_name, billing_cycle, period_start, period_end, subtotal, gst_percent, gst_amount, total,
                 payment_mode, transaction_id, status, issued_at, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'paid',$13,$14)
             RETURNING id`,
            [invoiceNo, input.salonId, input.planName, input.billingCycle, input.periodStart, input.periodEnd,
             subtotal, input.gstPercent, gst, total, input.paymentMode, input.transactionId, input.issuedAt.toISOString(), input.createdBy]
        );
        return ins.rows[0].id as string;
    },

    // The invoice for a completed plan upgrade. Amounts are taken from the stored, already-agreed upgrade quote (not split back
    // out of the payment), so the invoice states exactly the credit and tax the salon was shown. `paymentId` is null for a
    // zero-payable upgrade (fully covered by credit): it still gets an auditable invoice, of value 0.
    // Idempotent per upgrade: calling it again returns the same invoice and never takes another number.
    async createForUpgrade(db: Db, u: {
        upgradeId: string; salonId: string; subscriptionId: string; paymentId: string | null; planName: string; billingCycle: string;
        periodStart: string; periodEnd: string; subtotal: number; gstPercent: number; gstAmount: number; total: number;
        credit: number; description: string; paymentMode: string; transactionId: string | null; issuedAt: Date; createdBy: string | null;
    }) {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sub-invoice-upgrade:${u.upgradeId}`]);
        const existing = await db.query(`SELECT id FROM subscription_invoices WHERE upgrade_id = $1`, [u.upgradeId]);
        if (existing.rows[0]) return { id: existing.rows[0].id as string, created: false };

        const invoiceNo = await nextInvoiceNo(db, u.issuedAt);
        const ins = await db.query(
            `INSERT INTO subscription_invoices
                (invoice_no, salon_id, subscription_id, payment_id, plan_name, billing_cycle, period_start, period_end,
                 subtotal, gst_percent, gst_amount, total, payment_mode, transaction_id, status, issued_at, created_by,
                 kind, credit_amount, upgrade_id, description)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'paid',$15,$16,'upgrade',$17,$18,$19)
             RETURNING id`,
            [invoiceNo, u.salonId, u.subscriptionId, u.paymentId, u.planName, u.billingCycle, u.periodStart, u.periodEnd,
             u.subtotal, u.gstPercent, u.gstAmount, u.total, u.paymentMode, u.transactionId, u.issuedAt.toISOString(), u.createdBy,
             u.credit, u.upgradeId, u.description]
        );
        return { id: ins.rows[0].id as string, created: true };
    },

    // Hard delete. The invoice number is NOT reused (the sequence only moves forward), so deleting leaves a gap in the
    // numbering; if the invoice came from a payment, that payment shows up under "Awaiting bill" again.
    async remove(id: string) {
        const { rows } = await pool.query(
            `DELETE FROM subscription_invoices WHERE id = $1 RETURNING id, invoice_no, payment_id`,
            [id]
        );
        return rows[0] ?? null;
    },

    async markEmailed(id: string) {
        await pool.query(`UPDATE subscription_invoices SET emailed_at = NOW() WHERE id = $1`, [id]);
    },

    async salonExists(salonId: string) {
        const { rows } = await pool.query(`SELECT 1 FROM salons WHERE id = $1`, [salonId]);
        return rows.length > 0;
    },
};
