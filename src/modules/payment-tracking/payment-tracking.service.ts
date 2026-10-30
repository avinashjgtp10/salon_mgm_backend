import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";

// Super Admin > Payment Tracking. Manual customer / website payments with installments, money added by hand, and one combined ledger.
// Separate from Razorpay on purpose: nothing here touches subscriptions, subscription_payments or any gateway table.
//
//  - paid / remaining / status are always computed from the installment rows, never stored, so they cannot drift.
//  - the ledger is a query over installments + money added (no copy of any row), so a transaction can't appear twice.
//  - "voiding" keeps the row for history but removes it from every total and from the ledger.
//  - money added is never part of customer or website income.

export type Kind = "customer" | "website";
export const METHODS = ["cash", "upi", "bank_transfer", "card", "cheque", "razorpay", "other"] as const;

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS admin_receivables (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind         VARCHAR(10) NOT NULL CHECK (kind IN ('customer', 'website')),
        party_name   TEXT NOT NULL,
        salon_id     UUID REFERENCES salons(id) ON DELETE SET NULL,
        item_label   TEXT NOT NULL,
        total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
        due_date     DATE,
        notes        TEXT,
        created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE admin_receivables ADD COLUMN IF NOT EXISTS domain_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (domain_cost >= 0)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_receivables_kind ON admin_receivables (kind, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS admin_receivable_payments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receivable_id UUID NOT NULL REFERENCES admin_receivables(id) ON DELETE CASCADE,
        amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        paid_on       DATE NOT NULL DEFAULT CURRENT_DATE,
        method        VARCHAR(30),
        reference     TEXT,
        notes         TEXT,
        created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        voided_at     TIMESTAMPTZ,
        voided_by     UUID REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_receivable_payments_receivable ON admin_receivable_payments (receivable_id)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_receivable_payments_date ON admin_receivable_payments (paid_on DESC)`,
    `CREATE TABLE IF NOT EXISTS admin_money_added (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        added_on    DATE NOT NULL DEFAULT CURRENT_DATE,
        description TEXT NOT NULL,
        category    VARCHAR(40),
        amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        method      VARCHAR(30),
        created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        voided_at   TIMESTAMPTZ,
        voided_by   UUID REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_money_added_date ON admin_money_added (added_on DESC)`,
];

let ready: Promise<boolean> | null = null;
// Outside production the tables are created once, on first use. In production they come from Migration/create_payment_tracking.sql
// (set AUTO_APPLY_BILLING_SCHEMA=true to allow the automatic path there too).
const mayApply = () => process.env.NODE_ENV !== "production" || process.env.AUTO_APPLY_BILLING_SCHEMA === "true";

async function ensureSchema(): Promise<void> {
    if (!ready) {
        ready = (async () => {
            try {
                if (!mayApply()) {
                    const { rows } = await pool.query(
                        `SELECT (to_regclass('admin_receivables') IS NOT NULL AND to_regclass('admin_receivable_payments') IS NOT NULL
                                 AND to_regclass('admin_money_added') IS NOT NULL
                                 AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                                               AND table_name = 'admin_receivables' AND column_name = 'domain_cost')) AS present`
                    );
                    return Boolean(rows[0]?.present);
                }
                for (const sql of SCHEMA) await pool.query(sql);
                return true;
            } catch (err: any) {
                logger.warn("Payment tracking tables could not be applied", { error: err?.message });
                return false;
            }
        })();
    }
    if (!(await ready)) {
        ready = null;   // look again next time (the migration may have been run since)
        throw new AppError(503, "Payment tracking isn't available on this server yet (database migration create_payment_tracking.sql is missing).", "PAYMENT_TRACKING_SCHEMA_MISSING");
    }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, field: string, { required = false, max = 200 }: { required?: boolean; max?: number } = {}): string | null {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) {
        if (required) throw new AppError(400, `${field} is required`, "VALIDATION_ERROR");
        return null;
    }
    return s.slice(0, max);
}
function amount(v: unknown, field: string): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) throw new AppError(400, `${field} must be a number greater than 0`, "VALIDATION_ERROR");
    return round2(n);
}
/** An optional cost: blank means 0, otherwise a number that is 0 or more. */
function cost(v: unknown, field: string): number {
    if (v === undefined || v === null || v === "") return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new AppError(400, `${field} must be 0 or more`, "VALIDATION_ERROR");
    return round2(n);
}
function date(v: unknown, field: string, fallbackToday = false): string | null {
    if (v === undefined || v === null || v === "") {
        if (fallbackToday) return new Date().toISOString().slice(0, 10);
        return null;
    }
    if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(new Date(`${v}T12:00:00`).getTime())) throw new AppError(400, `${field} must be a date (YYYY-MM-DD)`, "VALIDATION_ERROR");
    return v;
}
function method(v: unknown): string | null {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !(METHODS as readonly string[]).includes(v)) throw new AppError(400, `payment method must be one of ${METHODS.join(", ")}`, "VALIDATION_ERROR");
    return v;
}
const kindOf = (v: unknown): Kind => {
    if (v !== "customer" && v !== "website") throw new AppError(400, "kind must be customer or website", "VALIDATION_ERROR");
    return v;
};

export interface Range { from?: string; to?: string }
const rangeOf = (q: { from?: unknown; to?: unknown }): Range => ({ from: date(q.from, "from") ?? undefined, to: date(q.to, "to") ?? undefined });

// Status is derived: Paid (nothing left), Overdue (past its due date with something left), Partial (some paid), Pending (nothing paid yet).
const RECEIVABLE_SQL = `
    SELECT r.id, r.kind, r.party_name, r.salon_id, r.item_label, r.due_date::text AS due_date, r.notes, r.created_at,
           ROUND(r.total_amount, 2)::float8 AS total_amount,
           ROUND(r.domain_cost, 2)::float8 AS domain_cost,
           ROUND(r.total_amount - r.domain_cost, 2)::float8 AS profit,
           ROUND(COALESCE(p.paid, 0), 2)::float8 AS paid_amount,
           ROUND(GREATEST(r.total_amount - COALESCE(p.paid, 0), 0), 2)::float8 AS remaining,
           p.last_paid_on::text AS last_paid_on,
           COALESCE(p.n, 0)::int AS payment_count,
           CASE WHEN r.total_amount - COALESCE(p.paid, 0) <= 0 THEN 'paid'
                WHEN r.due_date IS NOT NULL AND r.due_date < CURRENT_DATE THEN 'overdue'
                WHEN COALESCE(p.paid, 0) > 0 THEN 'partial'
                ELSE 'pending' END AS status
      FROM admin_receivables r
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS paid, MAX(paid_on) AS last_paid_on, COUNT(*) AS n
          FROM admin_receivable_payments WHERE receivable_id = r.id AND voided_at IS NULL
      ) p ON TRUE`;

async function receivableById(db: { query: typeof pool.query }, id: string) {
    const { rows } = await db.query(`SELECT * FROM (${RECEIVABLE_SQL}) x WHERE x.id = $1`, [id]);
    return rows[0] ?? null;
}

export const paymentTrackingService = {
    /** The four numbers at the top: customer income, what customers still owe, website income, and money added (never income). */
    async summary() {
        await ensureSchema();
        const { rows } = await pool.query(`
            SELECT
              COALESCE(SUM(paid) FILTER (WHERE kind = 'customer'), 0)::float8                  AS customer_received,
              COALESCE(SUM(remaining) FILTER (WHERE kind = 'customer'), 0)::float8             AS customer_remaining,
              COALESCE(SUM(paid) FILTER (WHERE kind = 'website'), 0)::float8                   AS website_received,
              COALESCE(SUM(remaining) FILTER (WHERE kind = 'website'), 0)::float8              AS website_remaining,
              COALESCE(SUM(overdue_left) FILTER (WHERE kind = 'customer'), 0)::float8          AS customer_overdue,
              COALESCE(SUM(total_amount) FILTER (WHERE kind = 'website'), 0)::float8           AS website_total,
              COALESCE(SUM(domain_cost) FILTER (WHERE kind = 'website'), 0)::float8            AS website_domain_cost
            FROM (
              SELECT kind, total_amount, domain_cost, COALESCE(paid, 0) AS paid, GREATEST(total_amount - COALESCE(paid, 0), 0) AS remaining,
                     CASE WHEN due_date < CURRENT_DATE THEN GREATEST(total_amount - COALESCE(paid, 0), 0) ELSE 0 END AS overdue_left
                FROM admin_receivables r
                LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM admin_receivable_payments WHERE receivable_id = r.id AND voided_at IS NULL) p ON TRUE
            ) t`);
        const { rows: money } = await pool.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS money_added FROM admin_money_added WHERE voided_at IS NULL`);
        return { ...rows[0], money_added: money[0].money_added };
    },

    async listReceivables(kind: unknown, q: { search?: unknown; status?: unknown; from?: unknown; to?: unknown }) {
        await ensureSchema();
        const k = kindOf(kind);
        const { from, to } = rangeOf(q);
        const params: any[] = [k];
        const where: string[] = [`x.kind = $1`];
        const search = text(q.search, "search", { max: 100 });
        if (search) { params.push(`%${search}%`); where.push(`(x.party_name ILIKE $${params.length} OR x.item_label ILIKE $${params.length})`); }
        if (typeof q.status === "string" && ["paid", "partial", "pending", "overdue"].includes(q.status)) { params.push(q.status); where.push(`x.status = $${params.length}`); }
        if (from) { params.push(from); where.push(`x.created_at::date >= $${params.length}`); }
        if (to) { params.push(to); where.push(`x.created_at::date <= $${params.length}`); }
        const { rows } = await pool.query(`SELECT * FROM (${RECEIVABLE_SQL}) x WHERE ${where.join(" AND ")} ORDER BY x.created_at DESC LIMIT 500`, params);
        return rows;
    },

    /** A new customer plan / website project that someone owes money for, optionally with the first payment already received. */
    async createReceivable(body: any, userId: string | null) {
        await ensureSchema();
        const k = kindOf(body?.kind);
        const party = text(body?.party_name, k === "customer" ? "Customer / salon" : "Client name", { required: true })!;
        const item = text(body?.item_label, k === "customer" ? "Plan" : "Website project", { required: true })!;
        const total = amount(body?.total_amount, "Total amount");
        const due = date(body?.due_date, "Due date");
        const salonId = typeof body?.salon_id === "string" && /^[0-9a-f-]{36}$/i.test(body.salon_id) ? body.salon_id : null;
        const first = body?.initial_payment && Number(body.initial_payment.amount) > 0 ? body.initial_payment : null;
        const firstAmount = first ? amount(first.amount, "Payment amount") : 0;
        if (firstAmount > total) throw new AppError(400, "The first payment can't be more than the total amount", "VALIDATION_ERROR");

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const ins = await client.query(
                `INSERT INTO admin_receivables (kind, party_name, salon_id, item_label, total_amount, due_date, notes, created_by, domain_cost)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [k, party, salonId, item, total, due, text(body?.notes, "notes", { max: 500 }), userId, k === "website" ? cost(body?.domain_cost, "Domain cost") : 0]
            );
            const id = ins.rows[0].id as string;
            if (first) {
                await client.query(
                    `INSERT INTO admin_receivable_payments (receivable_id, amount, paid_on, method, reference, notes, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [id, firstAmount, date(first.paid_on, "Payment date", true), method(first.method), text(first.reference, "reference", { max: 120 }), text(first.notes, "notes", { max: 500 }), userId]
                );
            }
            await client.query("COMMIT");
            return receivableById(pool, id);
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /** Correct the details of a receivable. The total can't be set below what has already been received. */
    async updateReceivable(id: string, body: any) {
        await ensureSchema();
        const cur = await receivableById(pool, id);
        if (!cur) throw new AppError(404, "Payment record not found", "NOT_FOUND");
        const total = body?.total_amount !== undefined ? amount(body.total_amount, "Total amount") : cur.total_amount;
        if (total < cur.paid_amount) throw new AppError(400, `The total can't be less than the ${cur.paid_amount} already received`, "VALIDATION_ERROR");
        await pool.query(
            `UPDATE admin_receivables SET party_name = $2, item_label = $3, total_amount = $4, due_date = $5, notes = $6, domain_cost = $7, updated_at = NOW() WHERE id = $1`,
            [
                id,
                body?.party_name !== undefined ? text(body.party_name, "Name", { required: true }) : cur.party_name,
                body?.item_label !== undefined ? text(body.item_label, "Plan / project", { required: true }) : cur.item_label,
                total,
                body?.due_date !== undefined ? date(body.due_date, "Due date") : cur.due_date,
                body?.notes !== undefined ? text(body.notes, "notes", { max: 500 }) : cur.notes,
                cur.kind === "website" && body?.domain_cost !== undefined ? cost(body.domain_cost, "Domain cost") : cur.domain_cost,
            ]
        );
        return receivableById(pool, id);
    },

    /** One installment (partial or the full remainder). It can never push the total received above the total amount. */
    async addPayment(receivableId: string, body: any, userId: string | null) {
        await ensureSchema();
        const amt = amount(body?.amount, "Payment amount");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            // Lock the row so two payments entered at the same moment can't both fit into the same remaining balance.
            const lock = await client.query(`SELECT id FROM admin_receivables WHERE id = $1 FOR UPDATE`, [receivableId]);
            if (!lock.rowCount) throw new AppError(404, "Payment record not found", "NOT_FOUND");
            const cur = await receivableById(client, receivableId);
            if (amt > cur.remaining + 0.001) throw new AppError(400, `Only ${cur.remaining} is remaining on this record`, "VALIDATION_ERROR");
            await client.query(
                `INSERT INTO admin_receivable_payments (receivable_id, amount, paid_on, method, reference, notes, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [receivableId, amt, date(body?.paid_on, "Payment date", true), method(body?.method), text(body?.reference, "reference", { max: 120 }), text(body?.notes, "notes", { max: 500 }), userId]
            );
            await client.query("COMMIT");
            return receivableById(pool, receivableId);
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /** Correct one installment (amount, date, method, reference, notes). The record's total received still can't go above its total amount. */
    async updatePayment(receivableId: string, paymentId: string, body: any) {
        await ensureSchema();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const lock = await client.query(`SELECT id FROM admin_receivables WHERE id = $1 FOR UPDATE`, [receivableId]);
            if (!lock.rowCount) throw new AppError(404, "Payment record not found", "NOT_FOUND");
            const { rows } = await client.query(
                `SELECT amount::float8 AS amount, paid_on::text AS paid_on, method, reference, notes FROM admin_receivable_payments
                  WHERE id = $2 AND receivable_id = $1 AND voided_at IS NULL`,
                [receivableId, paymentId]
            );
            const cur = rows[0];
            if (!cur) throw new AppError(404, "Payment not found or already cancelled", "NOT_FOUND");
            const record = await receivableById(client, receivableId);
            const amt = body?.amount !== undefined ? amount(body.amount, "Payment amount") : cur.amount;
            // What is left once this installment is taken out of the total, i.e. the most it may now be.
            if (amt > record.remaining + cur.amount + 0.001) throw new AppError(400, `The payment can be at most ${round2(record.remaining + cur.amount)}`, "VALIDATION_ERROR");
            await client.query(
                `UPDATE admin_receivable_payments SET amount = $3, paid_on = $4, method = $5, reference = $6, notes = $7 WHERE id = $2 AND receivable_id = $1`,
                [
                    receivableId, paymentId, amt,
                    body?.paid_on !== undefined ? date(body.paid_on, "Payment date", true) : cur.paid_on,
                    body?.method !== undefined ? method(body.method) : cur.method,
                    body?.reference !== undefined ? text(body.reference, "reference", { max: 120 }) : cur.reference,
                    body?.notes !== undefined ? text(body.notes, "notes", { max: 500 }) : cur.notes,
                ]
            );
            await client.query("COMMIT");
            return receivableById(pool, receivableId);
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /** Every installment of one record, voided ones included (marked), newest first. */
    async history(receivableId: string) {
        await ensureSchema();
        const record = await receivableById(pool, receivableId);
        if (!record) throw new AppError(404, "Payment record not found", "NOT_FOUND");
        const { rows } = await pool.query(
            `SELECT p.id, ROUND(p.amount, 2)::float8 AS amount, p.paid_on::text AS paid_on, p.method, p.reference, p.notes, p.created_at, p.voided_at,
                    TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS added_by
               FROM admin_receivable_payments p LEFT JOIN users u ON u.id = p.created_by
              WHERE p.receivable_id = $1 ORDER BY p.paid_on DESC, p.created_at DESC`,
            [receivableId]
        );
        return { record, payments: rows };
    },

    /** Cancel a wrongly entered installment. The row stays in the history, marked void, and leaves every total and the ledger. */
    async voidPayment(receivableId: string, paymentId: string, userId: string | null) {
        await ensureSchema();
        const r = await pool.query(
            `UPDATE admin_receivable_payments SET voided_at = NOW(), voided_by = $3 WHERE id = $2 AND receivable_id = $1 AND voided_at IS NULL`,
            [receivableId, paymentId, userId]
        );
        if (!r.rowCount) throw new AppError(404, "Payment not found or already cancelled", "NOT_FOUND");
        return receivableById(pool, receivableId);
    },

    async listMoneyAdded(q: { search?: unknown; from?: unknown; to?: unknown }) {
        await ensureSchema();
        const { from, to } = rangeOf(q);
        const params: any[] = [];
        const where = [`m.voided_at IS NULL`];
        const search = text(q.search, "search", { max: 100 });
        if (search) { params.push(`%${search}%`); where.push(`(m.description ILIKE $${params.length} OR COALESCE(m.category, '') ILIKE $${params.length})`); }
        if (from) { params.push(from); where.push(`m.added_on >= $${params.length}`); }
        if (to) { params.push(to); where.push(`m.added_on <= $${params.length}`); }
        const { rows } = await pool.query(
            `SELECT m.id, m.added_on::text AS date, m.description, m.category, ROUND(m.amount, 2)::float8 AS amount, m.method, m.created_at,
                    TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS added_by
               FROM admin_money_added m LEFT JOIN users u ON u.id = m.created_by
              WHERE ${where.join(" AND ")} ORDER BY m.added_on DESC, m.created_at DESC LIMIT 500`,
            params
        );
        return rows;
    },

    async addMoney(body: any, userId: string | null) {
        await ensureSchema();
        const { rows } = await pool.query(
            `INSERT INTO admin_money_added (added_on, description, category, amount, method, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [date(body?.date, "Date", true), text(body?.description, "Description", { required: true, max: 300 }), text(body?.category, "Category", { max: 40 }),
             amount(body?.amount, "Amount"), method(body?.method), userId]
        );
        return { id: rows[0].id };
    },

    async updateMoney(id: string, body: any) {
        await ensureSchema();
        const { rows } = await pool.query(
            `SELECT added_on::text AS added_on, description, category, amount::float8 AS amount, method FROM admin_money_added WHERE id = $1 AND voided_at IS NULL`, [id]
        );
        const cur = rows[0];
        if (!cur) throw new AppError(404, "Entry not found or already cancelled", "NOT_FOUND");
        await pool.query(
            `UPDATE admin_money_added SET added_on = $2, description = $3, category = $4, amount = $5, method = $6 WHERE id = $1`,
            [
                id,
                body?.date !== undefined ? date(body.date, "Date", true) : cur.added_on,
                body?.description !== undefined ? text(body.description, "Description", { required: true, max: 300 }) : cur.description,
                body?.category !== undefined ? text(body.category, "Category", { max: 40 }) : cur.category,
                body?.amount !== undefined ? amount(body.amount, "Amount") : cur.amount,
                body?.method !== undefined ? method(body.method) : cur.method,
            ]
        );
        return { id };
    },

    async voidMoney(id: string, userId: string | null) {
        await ensureSchema();
        const r = await pool.query(`UPDATE admin_money_added SET voided_at = NOW(), voided_by = $2 WHERE id = $1 AND voided_at IS NULL`, [id, userId]);
        if (!r.rowCount) throw new AppError(404, "Entry not found or already cancelled", "NOT_FOUND");
    },

    /** Every received installment (customer + website) and every money-added entry in one list. Built by query, never stored. */
    async ledger(q: { search?: unknown; type?: unknown; method?: unknown; from?: unknown; to?: unknown }) {
        await ensureSchema();
        const { from, to } = rangeOf(q);
        const params: any[] = [];
        const where: string[] = [];
        const search = text(q.search, "search", { max: 100 });
        if (search) { params.push(`%${search}%`); where.push(`(l.details ILIKE $${params.length} OR l.type ILIKE $${params.length} OR COALESCE(l.reference, '') ILIKE $${params.length})`); }
        if (typeof q.type === "string" && ["Customer Payment", "Website Payment", "Money Added"].includes(q.type)) { params.push(q.type); where.push(`l.type = $${params.length}`); }
        if (from) { params.push(from); where.push(`l.date >= $${params.length}`); }
        if (to) { params.push(to); where.push(`l.date <= $${params.length}`); }
        const { rows } = await pool.query(
            `SELECT * FROM (
               SELECT 'payment:' || p.id AS id, p.paid_on::text AS date, p.created_at,
                      r.party_name || ' - ' || r.item_label AS details,
                      CASE r.kind WHEN 'customer' THEN 'Customer Payment' ELSE 'Website Payment' END AS type,
                      ROUND(p.amount, 2)::float8 AS money_in, 0::float8 AS money_out, p.method, p.reference, r.id AS receivable_id, r.kind AS source
                 FROM admin_receivable_payments p JOIN admin_receivables r ON r.id = p.receivable_id
                WHERE p.voided_at IS NULL
               UNION ALL
               SELECT 'money:' || m.id, m.added_on::text, m.created_at, m.description || COALESCE(' (' || m.category || ')', ''),
                      'Money Added', ROUND(m.amount, 2)::float8, 0::float8, m.method, NULL, NULL, 'money'
                 FROM admin_money_added m WHERE m.voided_at IS NULL
             ) l
             ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
             ORDER BY l.date DESC, l.created_at DESC LIMIT 1000`,
            params
        );
        return rows;
    },
};
