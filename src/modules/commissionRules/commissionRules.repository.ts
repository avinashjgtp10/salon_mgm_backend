import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
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
        const columns = [
            "salon_id", "name", "source", "type", "rate", "rate_after_target", "condition_target", "condition_metric",
            "frequency", "scope_type", "scope_id", "status",
        ];
        const values: unknown[] = [
            salonId, data.name, data.source, data.type, data.rate,
            data.rate_after_target ?? null,
            data.condition_target ?? null,
            data.condition_metric ?? null,
            data.frequency ?? "monthly",
            data.scope_type ?? "salon",
            scopeId,
            data.status ?? "draft",
        ];
        const placeholders = values.map((_, i) => `$${i + 1}`);

        // `tiers` is only written for ladder rules. Writing it for every rule meant
        // an environment that hasn't run add_commission_rule_milestone_ladder.sql
        // yet failed EVERY save (percentage, fixed, monthly target too) with a
        // missing-column error, not just the new ladder type.
        if (data.tiers) {
            columns.push("tiers");
            values.push(JSON.stringify(data.tiers));
            placeholders.push(`$${values.length}::jsonb`);
        }

        try {
            const { rows } = await pool.query(
                `INSERT INTO commission_rules (${columns.join(", ")})
                 VALUES (${placeholders.join(", ")})
                 RETURNING *`,
                values
            );
            return rows[0];
        } catch (err: any) {
            // 42703 = undefined_column (no `tiers`), 23514 = check_violation (type list
            // doesn't include milestone_ladder yet) — both mean this environment's
            // database is missing the Milestone Ladder migration.
            if (data.type === "milestone_ladder" && (err?.code === "42703" || err?.code === "23514")) {
                throw new AppError(
                    503,
                    "Milestone Ladder isn't available in this environment yet — its database update hasn't been applied.",
                    "FEATURE_NOT_READY"
                );
            }
            throw err;
        }
    },

    async update(id: string, salonId: string, patch: UpdateCommissionRuleBody): Promise<CommissionRule | null> {
        const COLUMN_MAP: Record<string, string> = {
            name: "name",
            source: "source",
            type: "type",
            rate: "rate",
            rate_after_target: "rate_after_target",
            tiers: "tiers",
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

        // pg would serialise a JS array of objects as a Postgres array literal, not JSON.
        const setParts = entries.map(([col], i) => (col === "tiers" ? `${col} = $${i + 1}::jsonb` : `${col} = $${i + 1}`));
        const values: unknown[] = entries.map(([col, val]) => (col === "tiers" && val != null ? JSON.stringify(val) : val));
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
     * Another ACTIVE rule on the same staff/role/salon + source whose kind clashes:
     * a milestone_ladder and any other rule type are mutually exclusive — only one
     * kind may be active at a time, the other must be deleted first.
     */
    async findConflictingKind(
        salonId: string,
        rule: { source: string; type: string; scope_type: string; scope_id: string | null },
        excludeId?: string
    ): Promise<CommissionRule | null> {
        const { rows } = await pool.query(
            `SELECT * FROM commission_rules
             WHERE salon_id = $1 AND source = $2 AND status = 'active'
               AND scope_type = $3 AND scope_id IS NOT DISTINCT FROM $4
               AND (type = 'milestone_ladder') <> ($5 = 'milestone_ladder')
               AND ($6::uuid IS NULL OR id <> $6::uuid)
             LIMIT 1`,
            [salonId, rule.source, rule.scope_type, rule.scope_id, rule.type, excludeId ?? null]
        );
        return rows[0] || null;
    },

    /**
     * tiered_target progress for one rule row — reuses the exact same IST-month
     * cumulative-revenue query the calculation engine's threshold gate uses, so
     * the number shown here always matches what checkout actually applies.
     * Returns null for anything that isn't a staff-scoped tiered_target rule.
     */
    async getTieredTargetProgress(id: string, salonId: string): Promise<{ target: number; achieved: number } | null> {
        const rule = await this.findById(id, salonId);
        if (!rule || rule.type !== "tiered_target" || rule.condition_target == null || !rule.scope_id) return null;

        const IST = "Asia/Kolkata";
        // Same window the calculation engine uses: per IST day for a Daily rule.
        const unit = rule.frequency === "daily" ? "day" : "month";
        const { rows } = await pool.query(
            `SELECT COALESCE(SUM(revenue_amount),0)::float AS total
             FROM commission_earned
             WHERE staff_id = $1 AND rule_id = $2
               AND date_trunc('${unit}', earned_at AT TIME ZONE '${IST}') = date_trunc('${unit}', NOW() AT TIME ZONE '${IST}')`,
            [rule.scope_id, id]
        );
        return { target: Number(rule.condition_target), achieved: parseFloat(rows[0]?.total ?? "0") };
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
