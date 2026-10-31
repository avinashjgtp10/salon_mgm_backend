// The approved plan-upgrade pricing policy, in one place, so it is documented and adjustable without touching the maths.
//
//  1. Money already paid is credited, not ignored: the unused part of what the salon ACTUALLY paid (before GST) for its
//     current subscription is subtracted from the new plan's price. "Actually paid" comes from the verified payment /
//     invoice, not from the plan's list price. A plan an admin assigned with no payment recorded has paid nothing, so it
//     earns no credit.
//  2. Proration is by DAY: unused fraction = remaining days / total days of the current period.
//  3. Same billing cycle (e.g. Advance monthly -> Growth monthly) is an "upgrade": the current END DATE IS KEPT (the period is
//     not reset or extended) and the salon pays only the prorated difference.
//  4. A different billing cycle (e.g. Advance monthly -> Growth yearly) is a "term change": a new full term starts today at the
//     full new price, less the unused credit.
//  5. Credit never exceeds the new charge. On a term change (rule 4) any credit left after paying for the new term is turned into
//     extra whole days of the new plan at its daily price (so paid time is not lost); on a same-cycle upgrade the end date is
//     kept and leftover credit is not refunded or carried forward. Any remainder under one day is not refunded.
//  6. GST is charged on what remains after credit (the taxable value), at the plan GST rate.
//  7. All arithmetic is in whole paise with half-up rounding at each step, so the same inputs always give the same total.
//  8. Downgrades (a lower tier) and shorter billing cycles are not handled here: they are SCHEDULED to start when the current
//     period ends (subscription-plan-change.service.ts), so everything already paid for is used first, nothing is charged today
//     and nobody is charged twice for the same period.
//
// Set UPGRADE_CREDIT_ENABLED=false to turn rule 1 off (the new plan is then charged without any credit).

export interface UpgradePolicy {
    /** Credit the unused value of the current subscription (rule 1). */
    creditUnusedValue: boolean;
    /** How long a pending upgrade payment stays valid before it is treated as abandoned. */
    orderValidityMinutes: number;
}

export function loadUpgradePolicy(env: NodeJS.ProcessEnv = process.env): UpgradePolicy {
    const minutes = Number(env.UPGRADE_ORDER_VALIDITY_MINUTES);
    return {
        creditUnusedValue: env.UPGRADE_CREDIT_ENABLED !== "false",
        orderValidityMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 30,
    };
}
