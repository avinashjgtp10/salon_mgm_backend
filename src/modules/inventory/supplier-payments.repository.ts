import pool from "../../config/database";
import { CreateSupplierPaymentBody, ListSupplierPaymentsFilters, SupplierPayment } from "./inventory.types";

// Schema (supplier_payments) is NOT self-migrated from here — per project
// policy, schema changes are never auto-run. See
// Migration/add_supplier_payments.sql; run it by hand against each
// environment before using this module.

export const supplierPaymentsRepository = {
    async create(
        supplierId: string,
        data: CreateSupplierPaymentBody,
        salonId: string,
        createdBy: string,
    ): Promise<SupplierPayment> {
        const { rows } = await pool.query(
            `INSERT INTO supplier_payments
               (salon_id, supplier_id, amount, payment_date, payment_method, note, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [salonId, supplierId, data.amount, data.payment_date, data.payment_method, data.note ?? null, createdBy],
        );
        return rows[0];
    },

    async list(
        supplierId: string,
        filters: ListSupplierPaymentsFilters,
        salonId: string,
    ): Promise<{ data: SupplierPayment[]; total: number }> {
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM supplier_payments WHERE supplier_id = $1 AND salon_id = $2`,
            [supplierId, salonId],
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT * FROM supplier_payments
              WHERE supplier_id = $1 AND salon_id = $2
              ORDER BY payment_date DESC, created_at DESC
              LIMIT $3 OFFSET $4`,
            [supplierId, salonId, limit, offset],
        );

        // running_balance_after isn't a stored column — compute it here by
        // walking payments oldest-first against the supplier's total
        // purchases, then reversing to match the newest-first list order.
        const { rows: totalRows } = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0)::float8 AS total_purchase_amount
               FROM purchases WHERE supplier_id = $1 AND salon_id = $2`,
            [supplierId, salonId],
        );
        const totalPurchaseAmount = Number(totalRows[0].total_purchase_amount) || 0;

        const { rows: allPayments } = await pool.query(
            `SELECT id, amount FROM supplier_payments
              WHERE supplier_id = $1 AND salon_id = $2
              ORDER BY payment_date ASC, created_at ASC`,
            [supplierId, salonId],
        );
        const balanceAfterById = new Map<string, number>();
        let cumulativePaid = 0;
        for (const p of allPayments) {
            cumulativePaid += Number(p.amount) || 0;
            balanceAfterById.set(p.id, Math.max(0, totalPurchaseAmount - cumulativePaid));
        }

        const data = rows.map((row) => ({
            ...row,
            running_balance_after: balanceAfterById.get(row.id) ?? 0,
        }));

        return { data, total };
    },
};
