import logger from "../../config/logger";
import { getRazorpay } from "../../config/razorpay";

// The webhook is how a paid order normally gets applied. If it never arrives (not registered, wrong secret, downtime), ask
// Razorpay about the salon's recent unpaid orders and hand a captured payment to the same handler the webhook uses, so the same
// checks apply. A cancelled or failed order is included on purpose: money can still arrive for it, and it must be recorded.

export const ORDER_RECONCILE_MAX_AGE_DAYS = 7;
const PENDING_INTERVAL_MS = 30_000;
const CLOSED_INTERVAL_MS = 10 * 60_000;
const lastCheck = new Map<string, number>();

export async function reconcileRazorpayOrders(
    orders: { orderId: string; pending: boolean }[],
    handle: (event: any) => Promise<unknown>,
): Promise<void> {
    for (const { orderId, pending } of orders) {
        const now = Date.now();
        if (now - (lastCheck.get(orderId) ?? 0) < (pending ? PENDING_INTERVAL_MS : CLOSED_INTERVAL_MS)) continue;
        if (lastCheck.size > 1000) lastCheck.clear();
        lastCheck.set(orderId, now);
        try {
            const found: any = await ((await getRazorpay()).orders as any).fetchPayments(orderId);
            const captured = (found?.items ?? []).find((p: any) => p?.status === "captured");
            if (captured) await handle({ event: "payment.captured", payload: { payment: { entity: captured } } });
        } catch (err: any) {
            logger.warn("Reconciling a payment order with Razorpay failed", { orderId, detail: err?.error?.description ?? err?.message });
        }
    }
}
