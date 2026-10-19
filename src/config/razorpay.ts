import Razorpay from "razorpay";
import { AppError } from "../middleware/error.middleware";

let client: Razorpay | null = null;

// Lazily built so the app still boots (and every non-payment feature works) when the keys aren't set.
export function getRazorpay(): Razorpay {
    if (client) return client;
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
        throw new AppError(503, "Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)", "RAZORPAY_NOT_CONFIGURED");
    }
    client = new Razorpay({ key_id, key_secret });
    return client;
}

export type RazorpayPeriod = "monthly" | "yearly";

// Razorpay has no "quarterly" period: a quarter is a monthly plan billed every 3 months (interval 3).
export const razorpayBilling = (cycle: "monthly" | "quarterly" | "yearly"): { period: RazorpayPeriod; interval: number } =>
    cycle === "yearly" ? { period: "yearly", interval: 1 } : { period: "monthly", interval: cycle === "quarterly" ? 3 : 1 };

// Razorpay plans are immutable (the amount can never be edited), so every price change is a new plan.
// `amountRupees` is converted to paise here — the one place that conversion happens.
export async function createRazorpayPlan(opts: {
    name: string;
    description: string;
    period: RazorpayPeriod;
    interval: number;
    amountRupees: number;
}): Promise<string> {
    try {
        const plan = await getRazorpay().plans.create({
            period: opts.period,
            interval: opts.interval,
            item: {
                name: opts.name,
                description: opts.description,
                amount: Math.round(opts.amountRupees * 100),
                currency: "INR",
            },
        });
        return plan.id;
    } catch (err: any) {
        if (err instanceof AppError) throw err;
        const detail = err?.error?.description ?? err?.message ?? "unknown error";
        throw new AppError(502, `Razorpay could not create the plan: ${detail}`, "RAZORPAY_ERROR");
    }
}
