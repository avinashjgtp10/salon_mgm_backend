import { AppError } from "../../middleware/error.middleware";
import { salonSubscriptionRepository as repo } from "./salon-subscription.repository";
import { tierOfPlan } from "../subscription-billing/plan-tier";

const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Days left as CALENDAR days: the end day (the date part of the stored value, which is the day the admin picked) minus today's date in
 * India. The old Math.ceil on the time between now and the stored timestamp gave 31 or 32 for the same end day depending on the
 * time of day and on whether it was stored as midnight or 23:59:59. The Super Admin screens (utils/subscriptionDays.ts on the
 * frontend) use the same rule, so every figure agrees.
 */
export function calendarDaysLeft(end: string | Date, nowMs: number = Date.now()): number {
    const endDay = typeof end === "string" ? end.slice(0, 10) : end.toISOString().slice(0, 10);
    const today = new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
    const toUtcDay = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((toUtcDay(endDay) - toUtcDay(today)) / DAY);
}

function parseDate(v: unknown, field: string): Date {
    const d = typeof v === "string" && v ? new Date(v) : null;
    if (!d || Number.isNaN(d.getTime())) {
        throw new AppError(400, `${field} must be a valid date`, "VALIDATION_ERROR");
    }
    return d;
}

export const salonSubscriptionService = {
    listPlans() {
        return repo.listActivePlans();
    },

    async get(salonId: string) {
        if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
        if (!(await repo.salonExists(salonId))) throw new AppError(404, "Salon not found", "NOT_FOUND");
        const history = await repo.history(salonId);
        const now = Date.now();
        const withState = history.map((h) => {
            const end = h.status === "trialing" ? h.trial_end : (h.current_period_end ?? h.trial_end);
            const live = (h.status === "active" || h.status === "trialing") && (!end || new Date(end).getTime() > now);
            return {
                ...h,
                // Basic / Advance / Growth, whichever way the plan row records it (null for a custom or test plan).
                plan_tier: tierOfPlan({ tier: h.plan_tier_col, name: h.plan_name, slug: h.plan_slug }),
                ends_at: end ?? null,
                is_live: live,
                days_remaining: live && end ? Math.max(0, calendarDaysLeft(end, now)) : 0,
            };
        });
        // The plan the salon is on: the live one if there is one, else the newest that was really theirs (an unfinished checkout or a
        // scheduled replacement that has not started yet is not "the plan they bought").
        const current = withState.find((h) => h.is_live)
            ?? withState.find((h) => h.status !== "created" && h.status !== "authenticated")
            ?? withState[0] ?? null;
        return { current, history: withState };
    },

    // Moves the end date of the salon's current subscription to the END of `end_date` (UTC) - used to add or take
    // away remaining days. A date in the past is allowed (it ends the subscription), but must not precede the start.
    async adjustExpiry(salonId: string, body: { end_date?: unknown }) {
        if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
        const raw = typeof body.end_date === "string" ? body.end_date.trim() : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            throw new AppError(400, "end_date must be a date in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        const end = new Date(`${raw}T23:59:59.000Z`);
        if (Number.isNaN(end.getTime())) throw new AppError(400, "end_date must be a valid date", "VALIDATION_ERROR");
        if (!(await repo.salonExists(salonId))) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const result = await repo.adjustExpiry(salonId, end);
        if (result === "before_start") {
            throw new AppError(400, "The new end date must be after the subscription's start date", "VALIDATION_ERROR");
        }
        if (!result) {
            throw new AppError(409, "This salon has no active or trial subscription to adjust. Use Give plan in Salon Customization instead.", "NO_SUBSCRIPTION");
        }
        return { ends_at: result.updated.current_period_end, previous_end: result.previous_end };
    },

    async grant(salonId: string, body: { plan_id?: unknown; start_date?: unknown; end_date?: unknown }) {
        if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
        if (typeof body.plan_id !== "string" || !body.plan_id) {
            throw new AppError(400, "plan_id is required", "VALIDATION_ERROR");
        }
        const start = body.start_date ? parseDate(body.start_date, "start_date") : new Date();
        const end = parseDate(body.end_date, "end_date");
        if (end.getTime() <= start.getTime()) {
            throw new AppError(400, "end_date must be after start_date", "VALIDATION_ERROR");
        }
        if (!(await repo.salonExists(salonId))) throw new AppError(404, "Salon not found", "NOT_FOUND");
        const plan = await repo.findPlan(body.plan_id);
        if (!plan || !plan.is_active) throw new AppError(404, "Plan not found or inactive", "NOT_FOUND");

        const result = await repo.grant(salonId, plan.id, start, end);
        return { ...result, plan: { id: plan.id, name: plan.name } };
    },
};
