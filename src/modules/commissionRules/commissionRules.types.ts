export type CommissionRuleSource = "services" | "products" | "memberships" | "packages";
export type CommissionRuleType = "percentage" | "fixed" | "milestone" | "tiered_target" | "milestone_ladder";

/** One step of a milestone_ladder rule: reaching `target` monthly revenue earns a one-time flat `reward`. */
export type LadderTier = { target: number; reward: number };
export type ConditionMetric = "revenue" | "count";
export type CommissionFrequency = "daily" | "weekly" | "biweekly" | "monthly" | "custom";
export type CommissionScopeType = "salon" | "staff" | "role";
export type CommissionRuleStatus = "active" | "draft" | "expired";

export type CommissionRule = {
    id: string;
    salon_id: string;
    name: string;
    source: CommissionRuleSource;
    type: CommissionRuleType;
    /** Percentage value, fixed ₹ amount, or milestone reward — same field for all three types.
     *  For tiered_target, this is the commission rate BELOW the monthly target. */
    rate: number | null;
    /** tiered_target only: the commission rate AT/ABOVE the monthly target. */
    rate_after_target: number | null;
    /** milestone_ladder only: steps, ascending by target. `rate` holds the sum of all rewards. */
    tiers: LadderTier[] | null;
    /** Optional threshold gate: "they receive [rate] when they generate [condition_target] based on [condition_metric]".
     *  Required for milestone and tiered_target (the monthly target amount); optional for
     *  percentage/fixed (null/0 target = always applies). */
    condition_target: number | null;
    condition_metric: ConditionMetric | null;
    frequency: CommissionFrequency;
    scope_type: CommissionScopeType;
    scope_id: string | null;
    status: CommissionRuleStatus;
    created_at: string;
    updated_at: string;
};

export type CreateCommissionRuleBody = {
    name: string;
    source: CommissionRuleSource;
    type: CommissionRuleType;
    /** Ignored for milestone_ladder — the service derives it from `tiers`. */
    rate?: number;
    /** tiered_target only: the commission rate AT/ABOVE the monthly target. */
    rate_after_target?: number | null;
    /** milestone_ladder only. */
    tiers?: LadderTier[] | null;
    condition_target?: number | null;
    condition_metric?: ConditionMetric | null;
    frequency?: CommissionFrequency;
    scope_type?: CommissionScopeType;
    /** Single staff/role id — used when creating one rule directly. */
    scope_id?: string | null;
    /** Multiple staff ids — service fans this out into one rule row per staff. */
    scope_ids?: string[];
    status?: CommissionRuleStatus;
};

export type UpdateCommissionRuleBody = Partial<Omit<CreateCommissionRuleBody, "scope_ids">>;

export type CommissionRuleListQuery = {
    source?: CommissionRuleSource;
    status?: CommissionRuleStatus;
    scope_type?: CommissionScopeType;
    scope_id?: string;
};
