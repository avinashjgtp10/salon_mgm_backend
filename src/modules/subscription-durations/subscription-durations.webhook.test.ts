// The webhook path of a prepaid duration purchase, against a scripted fake database: a captured payment activates the term ONCE, however
// many times Razorpay repeats the event; a payment that does not match the stored order activates nothing; and an order that is not a
// duration order is handed back (null) so the upgrade flow can have it.

const state: { order: any | null; inserts: { subscriptions: any[][]; payments: any[][] }; applied: string[] } = { order: null, inserts: { subscriptions: [], payments: [] }, applied: [] };

const fakeQuery = async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, " ");
    if (/information_schema\.columns/.test(s)) return { rows: [{ plan_cols: 2, pay_cols: 3, sub_cols: 1 }] };
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s.trim())) return { rows: [] };
    // a purchase is a subscription_payments row now (no separate orders table)
    if (/WHERE p\.razorpay_order_id = \$1/.test(s)) return { rows: state.order && state.order.razorpay_order_id === params[0] ? [state.order] : [] };
    if (/WHERE p\.id = \$1 AND p\.duration_value IS NOT NULL FOR UPDATE OF p/.test(s)) return { rows: state.order ? [state.order] : [] };
    if (/razorpay_payment_id = \$1 AND id <> \$2/.test(s)) return { rows: [] };
    if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
    if (/INSERT INTO subscriptions/.test(s)) { state.inserts.subscriptions.push(params); return { rows: [{ id: "sub-1" }] }; }
    if (/UPDATE subscription_payments SET payment_status = 'paid'/.test(s)) { state.inserts.payments.push(params); state.order.status = "completed"; return { rows: [] }; }
    if (/UPDATE subscription_payments SET payment_status = 'needs_review'/.test(s)) { if (state.order.status === "pending") state.order.status = "needs_review"; return { rows: [] }; }
    if (/SELECT owner_id FROM salons/.test(s)) return { rows: [{ owner_id: "owner-1" }] };
    return { rows: [] };
};

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: any[]) => (fakeQuery as any)(...a), connect: async () => ({ query: (...a: any[]) => (fakeQuery as any)(...a), release: () => undefined }) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
    getRazorpay: async () => ({ subscriptions: { cancel: jest.fn() }, orders: { create: jest.fn() }, payments: { fetch: jest.fn() } }),
    getRazorpayCredentials: async () => ({ keyId: "rzp_test", keySecret: "secret" }),
}));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: { applyPlanTier: async (_s: string, tier: string) => { state.applied.push(tier); return true; } } }));
jest.mock("../subscription-invoices/subscription-invoices.repository", () => ({ subscriptionInvoicesRepository: { createFromPayment: async () => ({ id: "inv-1", created: true }) } }));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({ subscriptionInvoicesService: { emailInvoice: async () => undefined } }));
// The salon has no current subscription: this purchase is a brand-new term.
jest.mock("../subscription-billing/subscription-billing.service", () => ({
    loadSalonSubscriptions: async () => [], pickCurrentSubscription: () => null, subscriptionEnd: () => null,
}));

import { subscriptionDurationsService } from "./subscription-durations.service";
import { addDuration } from "./duration-pricing";

const order = () => ({
    id: "order-1", plan_id: "plan-term-1", salon_id: "salon-1", user_id: "owner-1", option_id: "opt-1", tier: "basic", kind: "new", label: "3 Months",
    duration_value: 3, duration_unit: "months", base_price: "1000.00", gst_percent: "18.00", gst_amount: "180.00", total: "1180.00",
    currency: "INR", razorpay_order_id: "order_RZP1", razorpay_payment_id: null, status: "pending",
});
const captured = (over: Partial<any> = {}) => ({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_RZP1", order_id: "order_RZP1", status: "captured", amount: 118000, currency: "INR", method: "upi", created_at: 1_800_000_000, ...over } } },
});

beforeEach(() => { state.order = order(); state.inserts = { subscriptions: [], payments: [] }; state.applied = []; });

describe("duration webhook", () => {
    it("activates the purchased term once, and applies the plan's features", async () => {
        expect(await subscriptionDurationsService.handleGatewayEvent(captured())).toBe("duration term activated");
        expect(state.inserts.subscriptions).toHaveLength(1);
        expect(state.inserts.payments).toHaveLength(1);
        // the stored snapshot is what was written on the subscription (label, duration, price, GST, total)
        const p = state.inserts.subscriptions[0];
        expect(p).toEqual(expect.arrayContaining(["3 Months", 3, "months", "1000.00", "18.00", "180.00", "1180.00"]));
        // the term ends exactly 3 calendar months after it starts
        expect(new Date(p[4]).toISOString()).toBe(addDuration(new Date(p[3]), 3, "months").toISOString());
        expect(state.applied).toEqual(["basic"]);
    });

    it("a repeated webhook (Razorpay retries) never grants a second term", async () => {
        await subscriptionDurationsService.handleGatewayEvent(captured());
        const again = await subscriptionDurationsService.handleGatewayEvent(captured());
        expect(again).toBe("duration order already completed");
        expect(state.inserts.subscriptions).toHaveLength(1);
        expect(state.inserts.payments).toHaveLength(1);
        expect(state.applied).toEqual(["basic"]);
    });

    it("activates nothing when the paid amount does not match the order", async () => {
        const r = await subscriptionDurationsService.handleGatewayEvent(captured({ amount: 100000 }));
        expect(r).toMatch(/needs review/);
        expect(state.inserts.subscriptions).toHaveLength(0);
        expect(state.order.status).toBe("needs_review");
    });

    it("activates nothing for a payment that is not captured", async () => {
        const r = await subscriptionDurationsService.handleGatewayEvent(captured({ status: "authorized" }));
        expect(r).toMatch(/needs review/);
        expect(state.inserts.subscriptions).toHaveLength(0);
    });

    it("a failed payment attempt keeps the order open and activates nothing", async () => {
        const r = await subscriptionDurationsService.handleGatewayEvent({ event: "payment.failed", payload: { payment: { entity: { id: "pay_X", order_id: "order_RZP1", error_description: "Card declined" } } } });
        expect(r).toMatch(/stays open/);
        expect(state.inserts.subscriptions).toHaveLength(0);
        expect(state.order.status).toBe("pending");
    });

    it("hands back an order that is not a duration order (it belongs to the upgrade flow)", async () => {
        expect(await subscriptionDurationsService.handleGatewayEvent(captured({ order_id: "order_SOMETHING_ELSE" }))).toBeNull();
    });
});
