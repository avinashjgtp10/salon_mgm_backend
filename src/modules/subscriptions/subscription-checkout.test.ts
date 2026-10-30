// Razorpay webhook: the real currency and amount of every charge are stored, never assumed to be INR; an INR charge is stored exactly
// as before (so Indian subscriptions and renewals are unaffected).

const poolQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: unknown[]) => poolQuery(...a) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }), getRazorpay: jest.fn(), createRazorpayPlan: jest.fn(), razorpayBilling: jest.fn() }));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({
  subscriptionInvoicesService: { generateForPaymentTx: jest.fn().mockResolvedValue(null), emailForTransaction: jest.fn(), billAllUnbilledForSalon: jest.fn() },
}));
jest.mock("../subscription-upgrade/subscription-upgrade.service", () => ({ subscriptionUpgradeService: {} }));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: {} }));
jest.mock("../subscription-billing/plan-tier", () => ({ tierOfPlan: jest.fn() }));

import { subscriptionCheckoutService } from "./subscription-checkout.service";

const chargedEvent = (payment: Record<string, unknown>) => ({
  event: "subscription.charged",
  payload: {
    subscription: { entity: { id: "sub_rzp_1", current_start: 1790000000, current_end: 1792600000 } },
    payment: { entity: { id: "pay_1", method: "card", created_at: 1790000100, ...payment } },
  },
});

function fakeClient() {
  const inserts: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    if (/FROM subscriptions WHERE razorpay_subscription_id/.test(sql)) return { rows: [{ id: "s1", salon_id: "salon1", status: "created" }], rowCount: 1 };
    if (/FROM subscription_payments WHERE transaction_id/.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO subscription_payments/.test(sql)) { inserts.push({ sql, params: params ?? [] }); return { rows: [{ id: "pay_row_1" }], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as any, inserts };
}

describe("webhook keeps the real transaction currency", () => {
  beforeEach(() => poolQuery.mockClear());

  it("a USD charge is stored as USD with its own amount (minor units / 100)", async () => {
    const { client, inserts } = fakeClient();
    expect(await subscriptionCheckoutService.processEvent(client, chargedEvent({ amount: 839, currency: "USD" }))).toBe("charged");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/currency\)/);
    expect(inserts[0].params[1]).toBe(8.39);
    expect(inserts[0].params).toContain("USD");
  });

  it("an INR charge is stored as INR, unchanged", async () => {
    const { client, inserts } = fakeClient();
    await subscriptionCheckoutService.processEvent(client, chargedEvent({ amount: 94282, currency: "INR" }));
    expect(inserts[0].params[1]).toBe(942.82);
    expect(inserts[0].params).toContain("INR");
  });

  it("a payment with no currency is treated as INR (older events)", async () => {
    const { client, inserts } = fakeClient();
    await subscriptionCheckoutService.processEvent(client, chargedEvent({ amount: 94282 }));
    expect(inserts[0].params).toContain("INR");
  });

  it("a repeated webhook for the same payment does not insert it twice", async () => {
    const { client, inserts } = fakeClient();
    (client.query as jest.Mock).mockImplementation(async (sql: string) => {
      if (/FROM subscriptions WHERE razorpay_subscription_id/.test(sql)) return { rows: [{ id: "s1", salon_id: "salon1", status: "active" }], rowCount: 1 };
      if (/FROM subscription_payments WHERE transaction_id/.test(sql)) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await subscriptionCheckoutService.processEvent(client, chargedEvent({ amount: 839, currency: "USD" }));
    expect(inserts).toHaveLength(0);
  });
});
