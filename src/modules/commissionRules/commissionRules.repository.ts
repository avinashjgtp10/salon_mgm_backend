import pool from "../../config/database";
import {
    CommissionRule,
    CommissionRuleListQuery,
    CreateCommissionRuleBody,
    UpdateCommissionRuleBody,
    CommissionRuleStatus,
} from "./commissionRules.types";

export const commissionRulesRepository = {
    async list(salonId: string, q: CommissionRuleListQuery): Promise<CommissionRule[]> {
        const conditions: string[] = ["salon_id = $1"];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (q.source) { conditions.push(`source = $${idx}`); values.push(q.source); idx++; }
        if (q.status) { conditions.push(`status = $${idx}`); values.push(q.status); idx++; }
        if (q.scope_type) { conditions.push(`scope_type = $${idx}`); values.push(q.scope_type); idx++; }
        if (q.scope_id) { conditions.push(`scope_id = $${idx}`); values.push(q.scope_id); idx++; }

        const { rows } = await pool.query(
            `SELECT * FROM commission_rules WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
            values
        );
        return rows;
    },

    async findById(id: string, salonId: string): Promise<CommissionRule | null> {
        const { rows } = await pool.query(
            `SELECT * FROM commission_rules WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    /** Creates a single rule row for one scope_id (or null for salon-wide). Fan-out across
     *  multiple staff (scope_ids) is handled by the service layer looping this per staff. */
    async create(salonId: string, data: CreateCommissionRuleBody, scopeId: string | null): Promise<CommissionRule> {
        const { rows } = await pool.query(
            `INSERT INTO commission_rules (
                salon_id, name, source, type, rate, condition_target, condition_metric,
                frequency, scope_type, scope_id, status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                salonId, data.name, data.source, data.type, data.rate,
                data.condition_target ?? null,
                data.condition_metric ?? null,
                data.frequency ?? "monthly",
                data.scope_type ?? "salon",
                scopeId,
                data.status ?? "draft",
            ]
        );
        return rows[0];
    },

    async update(id: string, salonId: string, patch: UpdateCommissionRuleBody): Promise<CommissionRule | null> {
        const COLUMN_MAP: Record<string, string> = {
            name: "name",
            source: "source",
            type: "type",
            rate: "rate",
            condition_target: "condition_target",
            condition_metric: "condition_metric",
            frequency: "frequency",
            scope_type: "scope_type",
            scope_id: "scope_id",
            status: "status",
        };

        const entries = (Object.keys(patch) as (keyof UpdateCommissionRuleBody)[])
            .filter((k) => k in COLUMN_MAP)
            .map((k) => [COLUMN_MAP[k as string], (patch as any)[k]] as [string, unknown]);

        if (entries.length === 0) return this.findById(id, salonId);

        const setParts = entries.map(([col], i) => `${col} = $${i + 1}`);
        const values: unknown[] = entries.map(([, val]) => val);
        setParts.push(`updated_at = NOW()`);
        values.push(id, salonId);

        const { rows } = await pool.query(
            `UPDATE commission_rules SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async updateStatus(id: string, salonId: string, status: CommissionRuleStatus): Promise<CommissionRule | null> {
        const { rows } = await pool.query(
            `UPDATE commission_rules SET status = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3 RETURNING *`,
            [status, id, salonId]
        );
        return rows[0] || null;
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM commission_rules WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },

    /**
     * Finds the single best-matching ACTIVE rule for a staff member + source,
     * used by commissionCalculationService at checkout. "Best match" = most
     * specific scope wins: staff-specific > role-specific > salon-wide. This is
     * an interim priority policy — a proper configurable priority/combine-rules
     * engine is a later phase.
     */
    async findActiveForCalculation(
        salonId: string,
        source: string,
        staffId: string,
        designation: string | null
    ): Promise<CommissionRule | null> {
        const { rows } = await pool.query(
            `SELECT * FROM commission_rules
             WHERE salon_id = $1 AND source = $2 AND status = 'active'
               AND (
                 scope_type = 'salon'
                 OR (scope_type = 'staff' AND scope_id = $3)
                 OR (scope_type = 'role' AND scope_id = $4)
               )
             ORDER BY CASE scope_type WHEN 'staff' THEN 0 WHEN 'role' THEN 1 ELSE 2 END
             LIMIT 1`,
            [salonId, source, staffId, designation]
        );
        return rows[0] || null;
    },
};
