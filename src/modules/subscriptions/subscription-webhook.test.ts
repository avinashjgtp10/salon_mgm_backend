// Webhook handling end to end (handleWebhook): idempotent, keeps each payment's real currency and amount, leaves existing INR subscriptions and
// renewals exactly as before, and runs the plan-change follow-up only AFTER the transaction has committed.

const calls: string[] = [];
let subStatus = "created";
let knownPayments = new Set<string>();
const inserted: { sql: string; params: unknown[] }[] = [];
const onAuthenticated = jest.fn().mockResolvedValue(undefined);
const emailForTransaction = jest.fn().mockResolvedValue(undefined);
let schemaReady = true;

const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
  const s = String(sql).trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) { calls.push(s.split(/\s/)[0]); return { rows: [], rowCount: 0 }; }
  if (/FROM subscriptions WHERE razorpay_subscription_id/.test(s)) return { rows: [{ id: "s1", salon_id: "salon1", status: subStatus }], rowCount: 1 };
  if (/FROM subscription_payments WHERE transaction_id/.test(s)) return { rows: knownPayments.has(String(params?.[0])) ? [{ x: 1 }] : [], rowCount: knownPayments.has(String(params?.[0])) ? 1 : 0 };
  if (/INSERT INTO subscription_payments/.test(s)) { inserted.push({ sql: s, params: params ?? [] }); knownPayments.add(String(params?.[3])); return { rows: [{ id: "pay_row" }], rowCount: 1 }; }
  return { rows: [], rowCount: 0 };
});

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: () => Promise.resolve({ query: clientQuery, release: jest.fn() }) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }), getRazorpay: jest.fn(), createRazorpayPlan: jest.fn(), razorpayBilling: jest.fn() }));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({
  subscriptionInvoicesService: { generateForPaymentTx: jest.fn().mockResolvedValue(null), emailForTransaction: (...a: unknown[]) => emailForTransaction(...a), billAllUnbilledForSalon: jest.fn() },
}));
jest.mock("../subscription-upgrade/subscription-upgrade.service", () => ({ subscriptionUpgradeService: {} }));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: {} }));
jest.mock("../subscription-billing/plan-tier", () => ({ tierOfPlan: jest.fn() }));
jest.mock("./subscription-plan-change.service", () => ({ subscriptionPlanChangeService: { onAuthenticated: (...a: unknown[]) => { calls.push("onAuthenticated"); return onAuthenticated(...a); } } }));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(schemaReady) }));

import { subscriptionCheckoutService } from "./subscription-checkout.service";

const event = (type: string, payment?: Record<string, unknown>) => ({
  event: type,
  payload: {
    subscription: { entity: { id: "sub_rzp_1", current_start: 1790000000, current_end: 1792600000 } },
    ...(payment ? { payment: { entity: { id: "pay_1", method: "card", created_at: 1790000100, ...payment } } } : {}),
  },
});

beforeEach(() => { calls.length = 0; inserted.length = 0; knownPayments = new Set(); subStatus = "created"; schemaReady = true; jest.clearAllMocks(); });

describe("webhook", () => {
  it("runs the plan-change follow-up only after COMMIT", async () => {
    expect(await subscriptionCheckoutService.handleWebhook(event("subscription.authenticated"))).toBe("authenticated");
    expect(onAuthenticated).toHaveBeenCalledWith("sub_rzp_1");
    expect(calls.indexOf("COMMIT")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("onAuthenticated")).toBeGreaterThan(calls.indexOf("COMMIT"));
    expect(inserted).toHaveLength(0);
  });

  it("does not run the follow-up for other events", async () => {
    await subscriptionCheckoutService.handleWebhook(event("subscription.activated"));
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("a failing follow-up fails the webhook so Razorpay retries it; the event itself was already committed, and handling it again is harmless", async () => {
    onAuthenticated.mockRejectedValueOnce(new Error("boom"));
    await expect(subscriptionCheckoutService.handleWebhook(event("subscription.authenticated"))).rejects.toThrow("boom");
    expect(calls).toContain("COMMIT");
    expect(inserted).toHaveLength(0);
    // Razorpay delivers it again: now it succeeds, and no payment is stored twice
    await expect(subscriptionCheckoutService.handleWebhook(event("subscription.authenticated"))).resolves.toBe("authenticated");
    expect(inserted).toHaveLength(0);
  });

  it("a delivered-twice charge is stored once (idempotent), in the payment's real currency", async () => {
    subStatus = "active";
    const charged = event("subscription.charged", { amount: 839, currency: "USD" });
    await subscriptionCheckoutService.handleWebhook(charged);
    await subscriptionCheckoutService.handleWebhook(charged);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].params).toEqual(expect.arrayContaining([8.39, "USD", "pay_1"]));
  });

  it("an INR renewal is stored exactly as before: INR, the paid amount, once per payment", async () => {
    subStatus = "active";
    await subscriptionCheckoutService.handleWebhook(event("subscription.charged", { id: "pay_renew_1", amount: 94282, currency: "INR" }));
    await subscriptionCheckoutService.handleWebhook(event("subscription.charged", { id: "pay_renew_2", amount: 94282, currency: "INR" }));   // next period
    expect(inserted).toHaveLength(2);
    for (const i of inserted) expect(i.params).toEqual(expect.arrayContaining([942.82, "INR"]));
  });

  it("on a database without the currency column an INR renewal still stores (the original INSERT)", async () => {
    schemaReady = false;
    subStatus = "active";
    await subscriptionCheckoutService.handleWebhook(event("subscription.charged", { amount: 94282, currency: "INR" }));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].sql).not.toMatch(/currency/);
    expect(inserted[0].params[1]).toBe(942.82);
  });

  it("an unknown subscription or event is acknowledged and ignored", async () => {
    expect(await subscriptionCheckoutService.handleWebhook({ event: "subscription.charged", payload: {} })).toMatch(/ignored/);
    expect(await subscriptionCheckoutService.handleWebhook(event("subscription.pending"))).toMatch(/ignored/);
    expect(inserted).toHaveLength(0);
  });
});
