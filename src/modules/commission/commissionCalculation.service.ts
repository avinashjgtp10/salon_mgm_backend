import pool from "../../config/database";
import logger from "../../config/logger";
import { staffCommissionsRepository, commissionSlabsRepository, commissionHistoryRepository } from "../staff/staffSettings.repository";
import { commissionRulesRepository } from "../commissionRules/commissionRules.repository";
import { SaleItem } from "../sales/sales.types";

// ─── Types ────────────────────────────────────────────────────────────────────

type CommissionCategory = "services" | "products" | "memberships" | "gift_cards" | "cancellation" | "packages";

const ITEM_TYPE_TO_CATEGORY: Record<string, CommissionCategory> = {
    service:    "services",
    product:    "products",
    membership: "memberships",
    gift_card:  "gift_cards",
};

interface CommissionEarned {
    id: string;
    staff_id: string;
    sale_id: string;
    category: CommissionCategory;
    revenue_amount: number;
    commission_kind: string;
    commission_rate: number;
    commission_amount: number;
    status: string;
    earned_at: string;
    rule_id?: string | null;
    tier_id?: string | null;
}

// ─── Repository ───────────────────────────────────────────────────────────────

const commissionEarnedRepository = {
    async insert(params: {
        salon_id: string;
        staff_id: string;
        sale_id: string;
        appointment_id?: string | null;
        category: CommissionCategory;
        revenue_amount: number;
        commission_kind: string;
        commission_rate: number;
        commission_amount: number;
        rule_id?: string | null;
        tier_id?: string | null;
    }): Promise<CommissionEarned> {
        const { rows } = await pool.query(
            `INSERT INTO commission_earned
                (salon_id, staff_id, sale_id, appointment_id, category,
                 revenue_amount, commission_kind, commission_rate, commission_amount, status,
                 rule_id, tier_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)
             RETURNING *`,
            [
                params.salon_id,
                params.staff_id,
                params.sale_id,
                params.appointment_id ?? null,
                params.category,
                params.revenue_amount,
                params.commission_kind,
                params.commission_rate,
                params.commission_amount,
                params.rule_id ?? null,
                params.tier_id ?? null,
            ]
        );
        return rows[0];
    },

    async listByStaff(staffId: string, month?: string): Promise<CommissionEarned[]> {
        if (month) {
            // month format: "YYYY-MM"
            const { rows } = await pool.query(
                `SELECT * FROM commission_earned
                 WHERE staff_id = $1
                   AND date_trunc('month', earned_at) = date_trunc('month', $2::date)
                 ORDER BY earned_at DESC`,
                [staffId, `${month}-01`]
            );
            return rows;
        }
        const { rows } = await pool.query(
            `SELECT * FROM commission_earned WHERE staff_id = $1 ORDER BY earned_at DESC`,
            [staffId]
        );
        return rows;
    },

    async summaryBySalon(salonId: string, month?: string): Promise<{
        total_commission: number;
        total_revenue: number;
        pending_payout: number;
        paid_out: number;
        count: number;
    }> {
        const dateFilter = month
            ? `AND date_trunc('month', earned_at) = date_trunc('month', '${month}-01'::date)`
            : "";
        const { rows } = await pool.query(
            `SELECT
                COALESCE(SUM(commission_amount), 0)                           AS total_commission,
                COALESCE(SUM(revenue_amount), 0)                             AS total_revenue,
                COALESCE(SUM(CASE WHEN status='pending' THEN commission_amount ELSE 0 END), 0) AS pending_payout,
                COALESCE(SUM(CASE WHEN status='paid'    THEN commission_amount ELSE 0 END), 0) AS paid_out,
                COUNT(*)                                                      AS count
             FROM commission_earned
             WHERE salon_id = $1 ${dateFilter}`,
            [salonId]
        );
        return {
            total_commission: parseFloat(rows[0].total_commission),
            total_revenue:    parseFloat(rows[0].total_revenue),
            pending_payout:   parseFloat(rows[0].pending_payout),
            paid_out:         parseFloat(rows[0].paid_out),
            count:            parseInt(rows[0].count),
        };
    },

    async earnedBySalon(salonId: string, month?: string): Promise<{
        staff_id: string;
        staff_first_name: string;
        staff_last_name: string | null;
        staff_email: string;
        staff_calendar_color: string | null;
        staff_designation: string | null;
        total_revenue: number;
        total_earned: number;
        pending_payout: number;
        paid_out: number;
        transaction_count: number;
        categories: string[];
    }[]> {
        const dateFilter = month
            ? `AND date_trunc('month', ce.earned_at) = date_trunc('month', ($2 || '-01')::date)`
            : "";
        const params: any[] = [salonId];
        if (month) params.push(month);

        const { rows } = await pool.query(
            `SELECT
                ce.staff_id,
                s.first_name        AS staff_first_name,
                s.last_name         AS staff_last_name,
                s.email             AS staff_email,
                s.calendar_color    AS staff_calendar_color,
                s.designation       AS staff_designation,
                COALESCE(SUM(ce.revenue_amount), 0)::numeric(12,2)    AS total_revenue,
                COALESCE(SUM(ce.commission_amount), 0)::numeric(12,2)  AS total_earned,
                COALESCE(SUM(CASE WHEN ce.status='pending' THEN ce.commission_amount ELSE 0 END),0)::numeric(12,2) AS pending_payout,
                COALESCE(SUM(CASE WHEN ce.status='paid'    THEN ce.commission_amount ELSE 0 END),0)::numeric(12,2) AS paid_out,
                COUNT(*)::int       AS transaction_count,
                array_agg(DISTINCT ce.category) AS categories
             FROM commission_earned ce
             JOIN staff s ON s.id = ce.staff_id
             WHERE ce.salon_id = $1 ${dateFilter}
             GROUP BY ce.staff_id, s.first_name, s.last_name, s.email, s.calendar_color, s.designation
             ORDER BY total_earned DESC`,
            params
        );
        return rows.map((r) => ({
            ...r,
            total_revenue:     parseFloat(r.total_revenue),
            total_earned:      parseFloat(r.total_earned),
            pending_payout:    parseFloat(r.pending_payout),
            paid_out:          parseFloat(r.paid_out),
            transaction_count: parseInt(r.transaction_count),
        }));
    },

    async markPaid(salonId: string, staffId: string): Promise<number> {
        const { rowCount } = await pool.query(
            `UPDATE commission_earned
             SET status = 'paid', paid_at = NOW(), updated_at = NOW()
             WHERE salon_id = $1 AND staff_id = $2 AND status = 'pending'`,
            [salonId, staffId]
        );
        return rowCount ?? 0;
    },

    async deleteBySaleId(saleId: string): Promise<void> {
        await pool.query(
            `DELETE FROM commission_earned WHERE sale_id = $1 AND status = 'pending'`,
            [saleId]
        );
    },
};

// ─── New-engine (commission_rules) evaluation ────────────────────────────────

/**
 * Evaluates the new commission_rules engine for one (staff_id, category) group.
 * Returns true if a matching ACTIVE rule was found and handled (whether or not
 * it actually produced a payout this time — e.g. a milestone tier not yet
 * reached still counts as "handled" so the legacy system doesn't double-count).
 */
async function tryNewEngineRule(params: {
    salonId: string;
    saleId: string;
    appointmentId?: string | null;
    staff_id: string;
    category: CommissionCategory;
    revenue: number;
    inserts: Promise<any>[];
}): Promise<boolean> {
    const { salonId, saleId, appointmentId, staff_id, category, revenue, inserts } = params;
    // services/products/memberships/packages map 1:1 onto the new engine's source enum
    const source = category as "services" | "products" | "memberships" | "packages";

    const { rows: staffRows } = await pool.query(`SELECT designation FROM staff WHERE id = $1`, [staff_id]);
    const designation = staffRows[0]?.designation ?? null;

    const rule = await commissionRulesRepository.findActiveForCalculation(salonId, source, staff_id, designation);
    if (!rule) return false;

    // ── Threshold gate (applies to all 3 types) ──────────────────────────────────
    // "They receive [rate] when they generate [condition_target] based on [condition_metric]"
    let periodMetric: number | null = null;
    if (rule.condition_target && rule.condition_metric) {
        const IST = "Asia/Kolkata";
        // Threshold always resets monthly — there's no separate period selector for the
        // condition itself in the simplified single-reward model (frequency governs payout
        // cadence, not the threshold window).
        const dateClause = `AND date_trunc('month', earned_at AT TIME ZONE '${IST}') = date_trunc('month', NOW() AT TIME ZONE '${IST}')`;

        const { rows: metricRows } = await pool.query(
            rule.condition_metric === "count"
                ? `SELECT COUNT(*)::float AS total FROM commission_earned WHERE staff_id=$1 AND rule_id=$2 ${dateClause}`
                : `SELECT COALESCE(SUM(revenue_amount),0)::float AS total FROM commission_earned WHERE staff_id=$1 AND rule_id=$2 ${dateClause}`,
            [staff_id, rule.id]
        );
        const priorMetric = parseFloat(metricRows[0]?.total ?? "0");
        periodMetric = priorMetric + (rule.condition_metric === "count" ? 1 : revenue);

        if (periodMetric < Number(rule.condition_target)) {
            logger.info("commissionCalculationService: below condition threshold", {
                staff_id, category, ruleId: rule.id, periodMetric, target: rule.condition_target,
            });
            return true; // handled — just didn't earn anything yet
        }
    }

    const rate = Number(rule.rate);

    if (rule.type === "milestone") {
        // One-time bonus per period once the threshold is crossed — check it hasn't
        // already been paid out this month before awarding again.
        const IST = "Asia/Kolkata";
        const dateClause = `AND date_trunc('month', earned_at AT TIME ZONE '${IST}') = date_trunc('month', NOW() AT TIME ZONE '${IST}')`;
        const { rows: alreadyPaidRows } = await pool.query(
            `SELECT 1 FROM commission_earned WHERE staff_id=$1 AND rule_id=$2 ${dateClause} LIMIT 1`,
            [staff_id, rule.id]
        );
        if (alreadyPaidRows.length > 0) return true; // already awarded this period

        inserts.push(
            commissionEarnedRepository.insert({
                salon_id: salonId, staff_id, sale_id: saleId,
                appointment_id: appointmentId ?? null,
                category, revenue_amount: parseFloat(revenue.toFixed(2)),
                commission_kind: "fixed_rate",
                commission_rate: rate,
                commission_amount: rate,
                rule_id: rule.id,
            })
        );
        logger.info("commissionCalculationService: milestone bonus awarded", {
            staff_id, saleId, category, ruleId: rule.id, reward: rate, periodMetric,
        });
        return true;
    }

    // percentage / fixed
    const commissionAmount = rule.type === "percentage"
        ? parseFloat((revenue * rate / 100).toFixed(2))
        : rate;

    if (commissionAmount > 0) {
        inserts.push(
            commissionEarnedRepository.insert({
                salon_id: salonId, staff_id, sale_id: saleId,
                appointment_id: appointmentId ?? null,
                category, revenue_amount: parseFloat(revenue.toFixed(2)),
                commission_kind: rule.type === "percentage" ? "percentage" : "fixed_rate",
                commission_rate: rate,
                commission_amount: commissionAmount,
                rule_id: rule.id,
            })
        );
        logger.info("commissionCalculationService: new-engine commission earned", {
            staff_id, saleId, category, ruleId: rule.id, type: rule.type, commissionAmount,
        });
    }

    return true;
}

// ─── Calculation Service ──────────────────────────────────────────────────────

export const commissionCalculationService = {

    /**
     * Called after a sale is checked out (status → completed).
     * Groups sale items by (staff_id, category), looks up commission rules,
     * calculates earned commission, and inserts records.
     *
     * Fire-and-forget safe — never throws, never blocks the checkout flow.
     */
    async calculateForSale(params: {
        salonId:       string;
        saleId:        string;
        appointmentId?: string | null;
        fallbackStaffId?: string | null;  // sale.staff_id (used when item has no staff)
        items:         SaleItem[];
        // sale_items has no 'package' item_type (DB CHECK constraint only allows
        // service/product/membership/gift_card/quick), so package line items are
        // stored as item_type='service' — this is how callers tell us which of
        // those item_ids are actually packages, so they get the "packages" rate
        // instead of silently being billed at the "services" rate.
        packageItemIds?: Set<string>;
    }): Promise<void> {
        const { salonId, saleId, appointmentId, fallbackStaffId, items, packageItemIds } = params;

        if (!items || items.length === 0) return;

        try {
            // Step 1: Group items by (staff_id, category) and sum revenue
            const groups = new Map<string, {
                staff_id: string;
                category: CommissionCategory;
                revenue: number;
            }>();

            for (const item of items) {
                const staffId = item.staff_id || fallbackStaffId;
                if (!staffId) continue; // no staff assigned — skip

                const category = (item.item_id && packageItemIds?.has(item.item_id))
                    ? "packages"
                    : ITEM_TYPE_TO_CATEGORY[item.item_type];
                if (!category) continue; // unknown item type — skip

                const key      = `${staffId}::${category}`;
                const revenue  = parseFloat(String(item.total_price)) * (item.quantity ?? 1);

                if (groups.has(key)) {
                    groups.get(key)!.revenue += revenue;
                } else {
                    groups.set(key, { staff_id: staffId, category, revenue });
                }
            }

            if (groups.size === 0) return;

            // Step 2: For each group, look up commission rule and calculate
            const inserts: Promise<any>[] = [];

            for (const { staff_id, category, revenue } of groups.values()) {
                try {
                    // ── New-engine commission_rules first — services/products/memberships only;
                    // gift_cards/cancellation aren't covered by the new engine yet, so those always
                    // fall through to the legacy path below. ──────────────────────────────────
                    if (category !== "gift_cards" && category !== "cancellation") {
                        const handled = await tryNewEngineRule({
                            salonId, saleId, appointmentId, staff_id, category, revenue, inserts,
                        });
                        if (handled) continue;
                    }

                    // Legacy staff_commission_settings predates "packages" as a category —
                    // packages are new-engine only, so there's nothing to fall back to here.
                    if (category === "packages") continue;

                    // Check if commission is enabled for this staff + category
                    const rule = await staffCommissionsRepository.findByCategory(staff_id, category);
                    if (!rule || !rule.is_enabled) continue;

                    const period = (rule as any).period ?? "monthly";

                    // ── Fetch accumulated period revenue (daily or monthly) ──────────────
                    // Used for threshold checks; commission amount is always on current sale revenue.
                    let periodRevenue = revenue;
                    try {
                        const IST = "Asia/Kolkata";
                        const dateClause = period === "daily"
                            ? `AND date_trunc('day', earned_at AT TIME ZONE '${IST}') = date_trunc('day', NOW() AT TIME ZONE '${IST}')`
                            : `AND date_trunc('month', earned_at AT TIME ZONE '${IST}') = date_trunc('month', NOW() AT TIME ZONE '${IST}')`;

                        const { rows: prevRows } = await pool.query(
                            `SELECT COALESCE(SUM(revenue_amount), 0)::float AS total
                             FROM commission_earned
                             WHERE staff_id = $1 AND category = $2 AND salon_id = $3 ${dateClause}`,
                            [staff_id, category, salonId]
                        );
                        periodRevenue = revenue + parseFloat(prevRows[0]?.total ?? "0");
                    } catch (qErr) {
                        logger.warn("commissionCalculationService: period revenue query failed, using sale revenue", { staff_id, category, qErr });
                    }

                    // ── Check minimum period revenue threshold ──────────────────────────
                    const minRevenue = Number((rule as any).min_monthly_revenue ?? 0);
                    if (minRevenue > 0 && periodRevenue < minRevenue) {
                        logger.info("commissionCalculationService: below min threshold", {
                            staff_id, category, periodRevenue, minRevenue, period,
                        });
                        continue;
                    }

                    // ── Try commission_slabs table first (multi-slab rules) ────────────────
                    const slabRows = await commissionSlabsRepository.listByStaffAndCategory(staff_id, category);

                    if (slabRows.length > 0) {
                        let totalCommission = 0;
                        for (const slab of slabRows) {
                            const target = Number(slab.revenue_target);
                            const value  = Number(slab.commission_value);
                            const kind   = slab.commission_kind;

                            // For revenue-target slabs: check if accumulated period revenue hits the threshold
                            if (target > 0 && periodRevenue < target) continue;

                            let slabCommission = 0;
                            if (kind === "percentage") {
                                // % of current sale's revenue
                                slabCommission = parseFloat((revenue * value / 100).toFixed(2));
                            } else if (target > 0) {
                                // Fixed: for every ₹target in current sale → ₹value
                                slabCommission = parseFloat((Math.floor(revenue / target) * value).toFixed(2));
                            } else {
                                // Flat amount — always apply
                                slabCommission = value;
                            }
                            totalCommission += slabCommission;
                        }

                        if (totalCommission <= 0) continue;

                        inserts.push(
                            commissionEarnedRepository.insert({
                                salon_id:          salonId,
                                staff_id,
                                sale_id:           saleId,
                                appointment_id:    appointmentId ?? null,
                                category,
                                revenue_amount:    parseFloat(revenue.toFixed(2)),
                                commission_kind:   slabRows[0].commission_kind,
                                commission_rate:   Number(slabRows[0].commission_value),
                                commission_amount: parseFloat(totalCommission.toFixed(2)),
                            })
                        );

                        logger.info("commissionCalculationService: slab commission earned", {
                            staff_id, saleId, category, revenue, periodRevenue, period,
                            totalCommission, slabCount: slabRows.length,
                        });

                    } else {
                        // ── Fallback to staff_commission_settings (single rule) ───────────
                        const rate          = Number(rule.default_rate);
                        const revenueTarget = Number((rule as any).revenue_target ?? 0);
                        const kind          = rule.commission_kind;

                        if (rate <= 0) continue;

                        // For revenue-target rules: check if accumulated period revenue hits the threshold
                        if (revenueTarget > 0 && periodRevenue < revenueTarget) {
                            logger.info("commissionCalculationService: period revenue below target", {
                                staff_id, category, periodRevenue, revenueTarget, period,
                            });
                            continue;
                        }

                        let commissionAmount: number;
                        if (kind === "percentage") {
                            commissionAmount = parseFloat((revenue * rate / 100).toFixed(2));
                        } else if (revenueTarget > 0) {
                            commissionAmount = parseFloat((Math.floor(revenue / revenueTarget) * rate).toFixed(2));
                        } else {
                            commissionAmount = rate;
                        }

                        if (commissionAmount <= 0) continue;

                        inserts.push(
                            commissionEarnedRepository.insert({
                                salon_id:          salonId,
                                staff_id,
                                sale_id:           saleId,
                                appointment_id:    appointmentId ?? null,
                                category,
                                revenue_amount:    parseFloat(revenue.toFixed(2)),
                                commission_kind:   kind,
                                commission_rate:   rate,
                                commission_amount: commissionAmount,
                            })
                        );

                        logger.info("commissionCalculationService: legacy commission earned", {
                            staff_id, saleId, category, revenue, periodRevenue, period,
                            kind, rate, commissionAmount,
                        });
                    }

                } catch (ruleErr) {
                    logger.error("commissionCalculationService: failed to process rule", {
                        staff_id, category, saleId, error: ruleErr,
                    });
                }
            }

            await Promise.allSettled(inserts);
            logger.info("commissionCalculationService: all commissions saved", { saleId, count: inserts.length });

        } catch (err) {
            // NEVER let commission errors break the checkout flow
            logger.error("commissionCalculationService: unexpected error", { saleId, error: err });
        }
    },

    /**
     * Reverse commissions when a sale is refunded/cancelled.
     * Only cancels 'pending' (unpaid) commissions.
     */
    async reverseForSale(saleId: string): Promise<void> {
        try {
            await commissionEarnedRepository.deleteBySaleId(saleId);
            logger.info("commissionCalculationService: commissions reversed", { saleId });
        } catch (err) {
            logger.error("commissionCalculationService: reverse failed", { saleId, error: err });
        }
    },

    // Expose repository methods for the overview/payroll pages
    async getSalonSummary(salonId: string, month?: string) {
        return commissionEarnedRepository.summaryBySalon(salonId, month);
    },

    async getStaffEarnings(staffId: string, month?: string) {
        return commissionEarnedRepository.listByStaff(staffId, month);
    },

    async getEarnedBySalon(salonId: string, month?: string) {
        return commissionEarnedRepository.earnedBySalon(salonId, month);
    },

    async markStaffPaid(salonId: string, staffId: string) {
        return commissionEarnedRepository.markPaid(salonId, staffId);
    },

    async getStaffHistory(staffId: string, month?: string) {
        return commissionHistoryRepository.listByStaff(staffId, month);
    },

    async exportBySalon(salonId: string, month?: string) {
        return commissionHistoryRepository.exportBySalon(salonId, month);
    },

    async upsertSlabs(staffId: string, salonId: string, category: string, slabs: any[]) {
        return commissionSlabsRepository.replaceForStaffAndCategory(staffId, salonId, category, slabs);
    },

    async getSlabs(staffId: string, category?: string) {
        if (category) return commissionSlabsRepository.listByStaffAndCategory(staffId, category);
        return commissionSlabsRepository.listByStaff(staffId);
    },
};