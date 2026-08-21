// Tip Settle — mirrors commissionCalculation.service.ts's shape (tip_earned /
// tip_settlements sit beside commission_earned / commission_settlements) but
// simpler: a tip has no category/revenue/rate to apportion, just an amount.
//
// Attribution: a sale's tip is earned by whichever staff member(s) actually
// worked on it. Since AppointmentModal's Split by Staff feature, that's
// sales.tip_breakdown (one entry per staff, added today — 2026-08-20). Older
// sales never populated it, so the fallback for those is sales.staff_id (the
// sale's single assigned staff) getting full credit for sales.tip_amount — a
// sale with tip_amount > 0 but neither tip_breakdown nor staff_id has no
// staff to attribute to and earns nothing (see earnForSale below).
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";

// ─── Bootstrap ──────────────────────────────────────────────────────────────
// Wired into app.ts startup, same self-healing ADD-COLUMN/CREATE-TABLE
// pattern as ensureAppointmentsTables etc. — every environment gets these
// tables the next time the server boots, no manual step required.
export async function ensureTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS tip_earned (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            salon_id    UUID NOT NULL,
            staff_id    UUID NOT NULL,
            sale_id     UUID,
            appointment_id UUID,
            tip_amount  NUMERIC NOT NULL DEFAULT 0,
            status      VARCHAR(20) NOT NULL DEFAULT 'pending',
            earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            paid_at     TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS tip_earned_salon_staff_idx ON tip_earned (salon_id, staff_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tip_earned_sale_idx ON tip_earned (sale_id)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tip_settlements (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            salon_id           UUID NOT NULL,
            staff_id           UUID NOT NULL,
            settled_amount     NUMERIC NOT NULL,
            remaining_balance  NUMERIC NOT NULL,
            status             VARCHAR(20) NOT NULL,
            payment_method     VARCHAR(30),
            settled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            settled_by         UUID,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS tip_settlements_salon_staff_idx ON tip_settlements (salon_id, staff_id)`);
}

// ─── tip_earned repository ─────────────────────────────────────────────────

interface TipEarned {
    id: string;
    salon_id: string;
    staff_id: string;
    sale_id: string | null;
    tip_amount: number;
    status: "pending" | "paid";
    earned_at: string;
}

const tipEarnedRepository = {
    async insert(params: {
        salon_id: string; staff_id: string; sale_id?: string | null; appointment_id?: string | null;
        tip_amount: number; status: "pending" | "paid"; earned_at?: Date | string; paid_at?: Date | string | null;
    }): Promise<TipEarned> {
        const { rows } = await pool.query(
            `INSERT INTO tip_earned (salon_id, staff_id, sale_id, appointment_id, tip_amount, status, earned_at, paid_at)
             VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, NOW()), $8)
             RETURNING *`,
            [
                params.salon_id, params.staff_id, params.sale_id ?? null, params.appointment_id ?? null,
                params.tip_amount, params.status, params.earned_at ?? null, params.paid_at ?? null,
            ]
        );
        return rows[0];
    },

    async deleteBySaleId(saleId: string): Promise<void> {
        await pool.query(`DELETE FROM tip_earned WHERE sale_id = $1 AND status = 'pending'`, [saleId]);
    },

    async summaryBySalon(
        salonId: string, startDate?: string, endDate?: string, staffIds?: string[]
    ): Promise<{ total_tips: number; pending_payout: number; paid_out: number; count: number }> {
        const params: any[] = [salonId];
        const clauses: string[] = [];
        let idx = 2;
        if (startDate && endDate) {
            clauses.push(`earned_at::date BETWEEN $${idx++}::date AND $${idx++}::date`);
            params.push(startDate, endDate);
        }
        if (staffIds && staffIds.length > 0) {
            clauses.push(`staff_id = ANY($${idx++}::uuid[])`);
            params.push(staffIds);
        }
        const filter = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
        const { rows } = await pool.query(
            `SELECT
                COALESCE(SUM(tip_amount), 0) AS total_tips,
                COALESCE(SUM(CASE WHEN status='pending' THEN tip_amount ELSE 0 END), 0) AS pending_payout,
                COALESCE(SUM(CASE WHEN status='paid'    THEN tip_amount ELSE 0 END), 0) AS paid_out,
                COUNT(*) AS count
             FROM tip_earned
             WHERE salon_id = $1 ${filter}`,
            params
        );
        return {
            total_tips:     parseFloat(rows[0].total_tips),
            pending_payout: parseFloat(rows[0].pending_payout),
            paid_out:       parseFloat(rows[0].paid_out),
            count:          parseInt(rows[0].count),
        };
    },

    async earnedBySalon(
        salonId: string, startDate?: string, endDate?: string, staffIds?: string[], status?: string
    ): Promise<{
        staff_id: string; staff_first_name: string; staff_last_name: string | null;
        staff_email: string; staff_calendar_color: string | null;
        total_tips: number; pending_payout: number; paid_out: number; transaction_count: number;
    }[]> {
        const params: any[] = [salonId];
        const clauses: string[] = [];
        let idx = 2;
        if (startDate && endDate) {
            clauses.push(`te.earned_at::date BETWEEN $${idx++}::date AND $${idx++}::date`);
            params.push(startDate, endDate);
        }
        if (staffIds && staffIds.length > 0) {
            clauses.push(`te.staff_id = ANY($${idx++}::uuid[])`);
            params.push(staffIds);
        }
        const filter = clauses.length ? `AND ${clauses.join(" AND ")}` : "";

        // Same post-aggregation "partial" convention as commission_earned's
        // earnedBySalon — status isn't a per-row concept, a staff counts as
        // Partial when their filtered range has both pending and paid tips.
        const { rows } = await pool.query(
            `SELECT
                te.staff_id,
                s.first_name     AS staff_first_name,
                s.last_name      AS staff_last_name,
                s.email          AS staff_email,
                s.calendar_color AS staff_calendar_color,
                COALESCE(SUM(te.tip_amount), 0)::numeric(12,2) AS total_tips,
                COALESCE(SUM(CASE WHEN te.status='pending' THEN te.tip_amount ELSE 0 END),0)::numeric(12,2) AS pending_payout,
                COALESCE(SUM(CASE WHEN te.status='paid'    THEN te.tip_amount ELSE 0 END),0)::numeric(12,2) AS paid_out,
                COUNT(*)::int AS transaction_count
             FROM tip_earned te
             JOIN staff s ON s.id = te.staff_id
             WHERE te.salon_id = $1 ${filter}
             GROUP BY te.staff_id, s.first_name, s.last_name, s.email, s.calendar_color
             ORDER BY total_tips DESC`,
            params
        );
        const mapped = rows.map((r) => ({
            ...r,
            total_tips:        parseFloat(r.total_tips),
            pending_payout:    parseFloat(r.pending_payout),
            paid_out:          parseFloat(r.paid_out),
            transaction_count: parseInt(r.transaction_count),
        }));
        if (!status) return mapped;
        return mapped.filter((r) => {
            const hasPending = r.pending_payout > 0;
            const hasPaid = r.paid_out > 0;
            if (status === "partial") return hasPending && hasPaid;
            if (status === "pending") return hasPending && !hasPaid;
            if (status === "paid") return hasPaid && !hasPending;
            return true;
        });
    },

    // Settles `amount` against a staff member's pending tip_earned rows,
    // oldest first — identical row-splitting convention to
    // commissionEarnedRepository.settlePartial, just without the
    // revenue-apportioning step (a tip row has nothing else to split).
    async settlePartial(
        salonId: string, staffId: string, amount: number, paymentMethod?: string | null, settledBy?: string | null
    ): Promise<{ settledAmount: number; remainingBalance: number; totalPendingBefore: number }> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: pendingRows } = await client.query(
                `SELECT * FROM tip_earned WHERE salon_id = $1 AND staff_id = $2 AND status = 'pending' ORDER BY earned_at ASC FOR UPDATE`,
                [salonId, staffId]
            );
            const totalPending = pendingRows.reduce((sum: number, r: any) => sum + parseFloat(r.tip_amount), 0);

            if (!Number.isFinite(amount) || amount <= 0) {
                throw new AppError(400, "Settlement amount must be greater than 0", "VALIDATION_ERROR");
            }
            if (amount > totalPending) {
                throw new AppError(400, "Settlement amount cannot exceed the unpaid tip", "VALIDATION_ERROR");
            }

            let remaining = amount;
            for (const row of pendingRows) {
                if (remaining <= 0) break;
                const rowAmount = parseFloat(row.tip_amount);
                if (rowAmount <= remaining) {
                    await client.query(`UPDATE tip_earned SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [row.id]);
                    remaining -= rowAmount;
                } else {
                    const remainingTip = rowAmount - remaining;
                    await client.query(`UPDATE tip_earned SET tip_amount=$1, updated_at=NOW() WHERE id=$2`, [remainingTip, row.id]);
                    await client.query(
                        `INSERT INTO tip_earned (salon_id, staff_id, sale_id, appointment_id, tip_amount, status, earned_at, paid_at)
                         VALUES ($1,$2,$3,$4,$5,'paid',$6,NOW())`,
                        [row.salon_id, row.staff_id, row.sale_id, row.appointment_id, remaining, row.earned_at]
                    );
                    remaining = 0;
                }
            }

            const remainingBalance = Math.round((totalPending - amount) * 100) / 100;
            await client.query(
                `INSERT INTO tip_settlements (salon_id, staff_id, settled_amount, remaining_balance, status, payment_method, settled_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [salonId, staffId, amount, remainingBalance, remainingBalance <= 0 ? "paid" : "partial", paymentMethod ?? null, settledBy ?? null]
            );

            await client.query("COMMIT");
            return { settledAmount: amount, remainingBalance, totalPendingBefore: totalPending };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async markPaid(salonId: string, staffId: string): Promise<number> {
        const { rowCount } = await pool.query(
            `UPDATE tip_earned SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE salon_id=$1 AND staff_id=$2 AND status='pending'`,
            [salonId, staffId]
        );
        return rowCount ?? 0;
    },
};

// ─── tip_settlements repository (audit trail) ──────────────────────────────

const tipSettlementsRepository = {
    async listByStaff(salonId: string, staffId: string, limit = 50) {
        const { rows } = await pool.query(
            `SELECT id, staff_id, settled_amount, remaining_balance, status, payment_method, settled_at
             FROM tip_settlements WHERE salon_id = $1 AND staff_id = $2 ORDER BY settled_at DESC LIMIT $3`,
            [salonId, staffId, limit]
        );
        return rows.map((r: any) => ({ ...r, settled_amount: parseFloat(r.settled_amount), remaining_balance: parseFloat(r.remaining_balance) }));
    },
};

// ─── Public service ─────────────────────────────────────────────────────────

export const tipCalculationService = {
    // Called from the same checkout paths that fire commission (appointments
    // .service.ts's checkout(), sales.service.ts's Quick Sale checkout) —
    // fire-and-forget there, same as commission, so a tip-attribution issue
    // never blocks a payment. Reads the sale's own tip_amount/tip_breakdown/
    // staff_id directly rather than taking them as params, so every caller
    // just passes saleId/salonId and this stays the single source of truth
    // for the attribution rule described at the top of this file.
    async earnForSale(saleId: string, salonId: string): Promise<void> {
        try {
            const { rows } = await pool.query(
                `SELECT tip_amount, tip_breakdown, staff_id, appointment_id FROM sales WHERE id = $1`,
                [saleId]
            );
            const sale = rows[0];
            if (!sale) return;
            const tipAmount = parseFloat(sale.tip_amount) || 0;
            if (tipAmount <= 0) return;

            const breakdown: { staff_id?: string; staffId?: string; amount: number }[] = Array.isArray(sale.tip_breakdown) ? sale.tip_breakdown : [];
            const entries = breakdown
                .map((b) => ({ staffId: b.staff_id ?? b.staffId, amount: Number(b.amount) || 0 }))
                .filter((b) => b.staffId && b.amount > 0);

            if (entries.length === 0 && sale.staff_id) {
                entries.push({ staffId: sale.staff_id, amount: tipAmount });
            }
            if (entries.length === 0) {
                // No breakdown and no single assigned staff — nothing to
                // attribute this tip to. Left unattributed rather than
                // guessed; see this file's header comment.
                return;
            }

            await Promise.all(entries.map((e) =>
                tipEarnedRepository.insert({
                    salon_id: salonId, staff_id: e.staffId!, sale_id: saleId,
                    appointment_id: sale.appointment_id ?? null, tip_amount: e.amount, status: "pending",
                })
            ));
        } catch (err) {
            logger.error("tipCalculationService.earnForSale failed", { saleId, error: err });
        }
    },

    async reverseForSale(saleId: string): Promise<void> {
        try {
            await tipEarnedRepository.deleteBySaleId(saleId);
        } catch (err) {
            logger.error("tipCalculationService.reverseForSale failed", { saleId, error: err });
        }
    },

    async getSalonSummary(salonId: string, startDate?: string, endDate?: string, staffIds?: string[]) {
        return tipEarnedRepository.summaryBySalon(salonId, startDate, endDate, staffIds);
    },

    async getEarnedBySalon(salonId: string, startDate?: string, endDate?: string, staffIds?: string[], status?: string) {
        return tipEarnedRepository.earnedBySalon(salonId, startDate, endDate, staffIds, status);
    },

    async markStaffPaid(salonId: string, staffId: string) {
        return tipEarnedRepository.markPaid(salonId, staffId);
    },

    async settleStaffTip(salonId: string, staffId: string, amount: number, paymentMethod?: string | null, settledBy?: string | null) {
        return tipEarnedRepository.settlePartial(salonId, staffId, amount, paymentMethod, settledBy);
    },

    async getSettlementHistory(salonId: string, staffId: string, limit?: number) {
        return tipSettlementsRepository.listByStaff(salonId, staffId, limit);
    },

    // Exposed for the backfill script only — inserts a single already-'paid'
    // row for a historical sale with no tip_breakdown, crediting whichever
    // single staff the sale was assigned to (see this file's header comment).
    // Never called from a live request path.
    async backfillEarned(params: {
        salon_id: string; staff_id: string; sale_id: string; appointment_id: string | null;
        tip_amount: number; earned_at: Date;
    }): Promise<void> {
        await tipEarnedRepository.insert({ ...params, status: "paid", paid_at: params.earned_at });
    },
};
