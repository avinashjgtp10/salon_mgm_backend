// What a salon's subscription means right now, derived from the stored row plus the clock. One function, so the billing
// page, the upgrade checks and the admin views can't disagree.

export type SubscriptionState = "active" | "expiring_soon" | "expired" | "pending_payment" | "suspended";

// The warning window already used by the in-app expiry banner (PlanExpiryBanner.tsx).
export const EXPIRING_SOON_DAYS = 30;

const DAY_MS = 86_400_000;

export interface StatusInput {
    status: string;
    periodEnd: Date | string | null;
    now?: Date;
    salonActive?: boolean;
    expiringSoonDays?: number;
}

/** Whole days left, rounded up (1 minute left = 1 day, so "0 days" only ever means expired / expires today). */
export function daysRemaining(periodEnd: Date | string | null, now: Date = new Date()): number | null {
    if (!periodEnd) return null;
    const end = new Date(periodEnd).getTime();
    if (Number.isNaN(end)) return null;
    return Math.ceil((end - now.getTime()) / DAY_MS);
}

export function deriveSubscriptionState(input: StatusInput): SubscriptionState {
    const now = input.now ?? new Date();
    if (input.salonActive === false) return "suspended";

    const s = input.status;
    // A checkout that was started but never confirmed by the payment gateway: not paid, not active.
    if (s === "created" || s === "authenticated") return "pending_payment";
    // The gateway halted/paused the renewals (failed charges), or it was paused by an admin.
    if (s === "paused" || s === "halted") return "suspended";

    if (s === "active" || s === "trialing") {
        const days = daysRemaining(input.periodEnd, now);
        if (days === null) return "active";            // no end date: open-ended
        if (days <= 0) return "expired";
        return days <= (input.expiringSoonDays ?? EXPIRING_SOON_DAYS) ? "expiring_soon" : "active";
    }
    // cancelled / completed / expired / upgraded (replaced by a newer plan)
    return "expired";
}

/** Live = currently entitles the salon to the software. */
export const isLiveState = (state: SubscriptionState) => state === "active" || state === "expiring_soon";
