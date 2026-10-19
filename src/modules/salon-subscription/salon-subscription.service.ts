import { AppError } from "../../middleware/error.middleware";
import { salonSubscriptionRepository as repo } from "./salon-subscription.repository";

const DAY = 24 * 60 * 60 * 1000;

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
                ends_at: end ?? null,
                is_live: live,
                days_remaining: live && end ? Math.max(0, Math.ceil((new Date(end).getTime() - now) / DAY)) : 0,
            };
        });
        return { current: withState[0] ?? null, history: withState };
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
