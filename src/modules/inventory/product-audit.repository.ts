import pool from "../../config/database";
import {
    ProductAudit, ProductAuditWithDetail, ProductAuditListRow,
    ProductAuditItem,
    CreateProductAuditBody, ListProductAuditsFilters, ProductAuditStatus,
} from "./product-audit.types";

// Schema (product_audits, product_audit_items, product_audit_history) is NOT
// self-migrated from here — per project policy, schema changes are never
// auto-run. See Migration/create_product_audits_tables.sql; run it by hand
// against each environment before using this module.

const AUDIT_SELECT = `
  SELECT pa.*,
         NULLIF(TRIM(CONCAT(au.first_name, ' ', COALESCE(au.last_name, ''))), '') AS auditor_name,
         NULLIF(TRIM(CONCAT(ru.first_name, ' ', COALESCE(ru.last_name, ''))), '') AS reviewer_name
    FROM product_audits pa
    LEFT JOIN users au ON au.id = pa.auditor_id
    LEFT JOIN users ru ON ru.id = pa.reviewer_id`;

// product_audit_items only stores product_id — name/sku/category are always
// resolved live via this join (never denormalized onto the row), so a later
// rename in the catalog is reflected instead of frozen at add-time.
const ITEM_SELECT = `
  SELECT pai.*, p.name AS product_name, p.sku, sc.name AS category
    FROM product_audit_items pai
    JOIN products p ON p.id = pai.product_id
    LEFT JOIN service_categories sc ON sc.id = p.category_id
   WHERE pai.audit_id = $1
   ORDER BY pai.created_at ASC`;

const HISTORY_SELECT = `
  SELECT pah.*,
         NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS actor_name
    FROM product_audit_history pah
    LEFT JOIN users u ON u.id = pah.actor_id
   WHERE pah.audit_id = $1
   ORDER BY pah.created_at ASC`;

// Whole bottles/packs from base units — same convention as
// product-inventory.repository.ts's STOCK_IN_PACKS, so an audit's System Qty
// column matches what Product Inventory shows as "Available".
const STOCK_IN_PACKS = `
  CASE WHEN COALESCE(p.bottle_size, 0) > 0
       THEN COALESCE(p.amount, 0) / p.bottle_size
       ELSE COALESCE(p.amount, 0) END`;

export const productAuditRepository = {
    /** True when userId is a user_id on an active staff row (or the salon
     *  owner/admin account itself) for this salon — used to validate a
     *  caller-supplied auditor_id actually belongs to this salon before
     *  trusting it, the same way product_id/category_id are checked
     *  elsewhere in this module. */
    async isSalonMember(userId: string, salonId: string): Promise<boolean> {
        const { rows } = await pool.query(
            `SELECT 1 FROM staff WHERE user_id = $1 AND salon_id = $2
             UNION SELECT 1 FROM salons WHERE id = $2 AND owner_id = $1
             LIMIT 1`,
            [userId, salonId],
        );
        return rows.length > 0;
    },

    async create(data: CreateProductAuditBody, salonId: string, auditorId: string): Promise<ProductAudit> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const { rows } = await client.query(
                `INSERT INTO product_audits (salon_id, branch_id, name, notes, auditor_id)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [salonId, data.branch_id, data.name, data.notes ?? null, auditorId],
            );
            const audit = rows[0];
            await client.query(
                `INSERT INTO product_audit_history (audit_id, actor_id, action)
                 VALUES ($1, $2, 'Audit created')`,
                [audit.id, auditorId],
            );
            await client.query("COMMIT");
            return audit;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async list(filters: ListProductAuditsFilters, salonId: string): Promise<{ data: ProductAuditListRow[]; total: number }> {
        const conditions: string[] = [`pa.salon_id = $1`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.branch_id) { conditions.push(`pa.branch_id = $${idx++}`); values.push(filters.branch_id); }
        if (filters.status) { conditions.push(`pa.status = $${idx++}`); values.push(filters.status); }
        if (filters.search) {
            conditions.push(`pa.name ILIKE $${idx++}`);
            values.push(`%${filters.search}%`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM product_audits pa ${where}`, values,
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT pa.*,
                    NULLIF(TRIM(CONCAT(au.first_name, ' ', COALESCE(au.last_name, ''))), '') AS auditor_name,
                    NULLIF(TRIM(CONCAT(ru.first_name, ' ', COALESCE(ru.last_name, ''))), '') AS reviewer_name,
                    (SELECT COUNT(*) FROM product_audit_items pai WHERE pai.audit_id = pa.id)::int AS item_count,
                    (SELECT COUNT(*) FROM product_audit_items pai
                       WHERE pai.audit_id = pa.id
                         AND pai.physical_qty IS NOT NULL
                         AND pai.physical_qty <> pai.system_qty)::int AS diff_count
               FROM product_audits pa
               LEFT JOIN users au ON au.id = pa.auditor_id
               LEFT JOIN users ru ON ru.id = pa.reviewer_id
               ${where}
              ORDER BY pa.updated_at DESC
              LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset],
        );

        return { data: rows, total };
    },

    async getById(id: string, salonId: string): Promise<ProductAuditWithDetail | null> {
        const { rows: auditRows } = await pool.query(
            `${AUDIT_SELECT} WHERE pa.id = $1 AND pa.salon_id = $2`,
            [id, salonId],
        );
        if (!auditRows.length) return null;

        const { rows: itemRows } = await pool.query(ITEM_SELECT, [id]);
        const { rows: historyRows } = await pool.query(HISTORY_SELECT, [id]);

        return { ...auditRows[0], items: itemRows, history: historyRows };
    },

    /** Raw status/salon check without the joins — used by service-layer guards. */
    async findStatus(id: string, salonId: string): Promise<{ id: string; status: ProductAuditStatus } | null> {
        const { rows } = await pool.query(
            `SELECT id, status FROM product_audits WHERE id = $1 AND salon_id = $2`,
            [id, salonId],
        );
        return rows[0] || null;
    },

    async addItems(auditId: string, productIds: string[], salonId: string): Promise<ProductAuditItem[]> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: prodRows } = await client.query(
                `SELECT p.id, p.name, p.sku, sc.name AS category, (${STOCK_IN_PACKS})::float8 AS system_qty
                   FROM products p
                   LEFT JOIN service_categories sc ON sc.id = p.category_id
                  WHERE p.id = ANY($1::uuid[]) AND p.salon_id = $2`,
                [productIds, salonId],
            );
            if (prodRows.length !== productIds.length) {
                throw new Error("One or more products not found in this salon");
            }

            const inserted: ProductAuditItem[] = [];
            for (const p of prodRows) {
                const { rows } = await client.query(
                    `INSERT INTO product_audit_items (audit_id, product_id, system_qty)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (audit_id, product_id) DO NOTHING
                     RETURNING *`,
                    [auditId, p.id, p.system_qty],
                );
                if (rows[0]) {
                    inserted.push({ ...rows[0], product_name: p.name, sku: p.sku, category: p.category });
                }
            }

            await client.query("COMMIT");
            return inserted;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async removeItem(auditId: string, itemId: string): Promise<void> {
        await pool.query(
            `DELETE FROM product_audit_items WHERE id = $1 AND audit_id = $2`,
            [itemId, auditId],
        );
    },

    async updateItem(
        auditId: string, itemId: string, physicalQty: number | null, reason: string | null,
    ): Promise<ProductAuditItem | null> {
        const { rows } = await pool.query(
            `UPDATE product_audit_items
                SET physical_qty = $1, reason = $2, updated_at = NOW()
              WHERE id = $3 AND audit_id = $4
              RETURNING *`,
            [physicalQty, reason, itemId, auditId],
        );
        return rows[0] || null;
    },

    async countMissingReasons(auditId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COUNT(*) FROM product_audit_items
              WHERE audit_id = $1
                AND physical_qty IS NOT NULL
                AND physical_qty <> system_qty
                AND (reason IS NULL OR TRIM(reason) = '')`,
            [auditId],
        );
        return parseInt(rows[0].count, 10);
    },

    async countItems(auditId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COUNT(*) FROM product_audit_items WHERE audit_id = $1`,
            [auditId],
        );
        return parseInt(rows[0].count, 10);
    },

    async addHistory(auditId: string, actorId: string | null, action: string, note?: string | null): Promise<void> {
        await pool.query(
            `INSERT INTO product_audit_history (audit_id, actor_id, action, note)
             VALUES ($1, $2, $3, $4)`,
            [auditId, actorId, action, note ?? null],
        );
    },

    async transitionStatus(
        auditId: string,
        salonId: string,
        patch: { status: ProductAuditStatus; reviewer_id?: string | null; rejection_reason?: string | null },
    ): Promise<ProductAudit> {
        const { rows } = await pool.query(
            `UPDATE product_audits
                SET status = $1,
                    reviewer_id = COALESCE($2, reviewer_id),
                    rejection_reason = $3,
                    updated_at = NOW()
              WHERE id = $4 AND salon_id = $5
              RETURNING *`,
            [patch.status, patch.reviewer_id ?? null, patch.rejection_reason ?? null, auditId, salonId],
        );
        return rows[0];
    },

    async delete(id: string, salonId: string): Promise<void> {
        await pool.query(`DELETE FROM product_audits WHERE id = $1 AND salon_id = $2`, [id, salonId]);
    },
};
