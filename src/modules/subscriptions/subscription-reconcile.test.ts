// A paid subscription must not stay inactive because Razorpay's webhook never arrived (not registered, wrong secret, downtime):
// reconcilePending() asks Razorpay and applies the same event the webhook would have. Also: a plan paid for BEFORE the salon existed gets
// its features once onboarding attaches it (attachPendingToSalon).

const inserted: { sql: string; params: unknown[] }[] = [];
const statements: string[] = [];
let pendingRows: { rzp: string }[] = [];
let attachedRows: { id: string; status: string }[] = [];
let planOwner: { salon_id: string | null; tier: string; name: string; slug: string; owner_id: string } | null = null;

const fetchSub = jest.fn();
const listInvoices = jest.fn();
const fetchPayment = jest.fn();
const applyPlanTier = jest.fn().mockResolvedValue(true);
const emailForTransaction = jest.fn().mockResolvedValue(undefined);

const clientQuery = jest.fn(async (sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }> => {
  const s = String(sql).trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) { statements.push(s.split(/\s/)[0]); return { rows: [], rowCount: 0 }; }
  if (/FROM subscriptions WHERE razorpay_subscription_id/.test(s)) return { rows: [{ id: "s1", salon_id: "salon1", status: "created" }], rowCount: 1 };
  if (/FROM subscription_payments WHERE transaction_id/.test(s)) return { rows: [], rowCount: 0 };
  if (/INSERT INTO subscription_payments/.test(s)) { inserted.push({ sql: s, params: params ?? [] }); return { rows: [{ id: "pay_row" }], rowCount: 1 }; }
  if (/UPDATE subscriptions\s+SET status = 'active'/.test(s)) { statements.push("ACTIVATE"); return { rows: [], rowCount: 1 }; }
  return { rows: [], rowCount: 0 };
});

const poolQuery = jest.fn(async (sql: string): Promise<{ rows: any[]; rowCount: number }> => {
  const s = String(sql);
  if (/status IN \('created', 'authenticated'\)/.test(s)) return { rows: pendingRows, rowCount: pendingRows.length };
  if (/UPDATE subscriptions SET salon_id/.test(s)) return { rows: attachedRows, rowCount: attachedRows.length };
  if (/status = 'active' AND razorpay_subscription_id IS NOT NULL/.test(s)) return { rows: [{ razorpay_subscription_id: "sub_paid" }], rowCount: 1 };
  if (/JOIN subscription_plans sp ON sp.id = s.plan_id LEFT JOIN salons/.test(s)) return { rows: planOwner ? [planOwner] : [], rowCount: planOwner ? 1 : 0 };
  return { rows: [], rowCount: 0 };
});

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: [string]) => poolQuery(...a), connect: () => Promise.resolve({ query: clientQuery, release: jest.fn() }) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: null, keySecret: null, webhookSecret: null }),
  getRazorpay: async () => ({ subscriptions: { fetch: fetchSub }, invoices: { all: listInvoices }, payments: { fetch: fetchPayment } }),
  createRazorpayPlan: jest.fn(),
  razorpayBilling: jest.fn(),
}));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({
  subscriptionInvoicesService: { generateForPaymentTx: jest.fn().mockResolvedValue(null), emailForTransaction: (...a: unknown[]) => emailForTransaction(...a), billAllUnbilledForSalon: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../subscription-upgrade/subscription-upgrade.service", () => ({ subscriptionUpgradeService: {} }));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: { applyPlanTier: (...a: unknown[]) => applyPlanTier(...a) } }));
jest.mock("../subscription-billing/plan-tier", () => ({ tierOfPlan: () => "basic" }));
jest.mock("./subscription-plan-change.service", () => ({ subscriptionPlanChangeService: { onAuthenticated: jest.fn().mockResolvedValue(undefined) } }));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(true) }));

import { subscriptionCheckoutService } from "./subscription-checkout.service";

// Each test uses its own Razorpay subscription id: the per-subscription throttle is module state.
let n = 0;
const nextId = () => `sub_rzp_${++n}`;
const rzpSub = (id: string, status: string) => ({ id, status, current_start: 1790000000, current_end: 1792600000 });
const rzpPayment = { id: "pay_1", method: "upi", amount: 94282, currency: "INR", created_at: 1790000100 };

beforeEach(() => {
  jest.clearAllMocks();
  inserted.length = 0; statements.length = 0;
  pendingRows = []; attachedRows = [];
  planOwner = { salon_id: "salon1", tier: "basic", name: "SalonOx Basic", slug: "salonox-basic-monthly", owner_id: "owner1" };
  listInvoices.mockResolvedValue({ items: [{ status: "paid", payment_id: "pay_1" }] });
  fetchPayment.mockResolvedValue(rzpPayment);
});

describe("reconcilePending: Razorpay says paid, the webhook never came", () => {
  it("activates the subscription, records the payment, and gives the salon the plan's features", async () => {
    const id = nextId();
    pendingRows = [{ rzp: id }];
    fetchSub.mockResolvedValue(rzpSub(id, "active"));

    expect(await subscriptionCheckoutService.reconcilePending("user1", "salon1")).toBe(1);

    expect(statements).toContain("ACTIVATE");
    expect(statements.indexOf("COMMIT")).toBeGreaterThan(statements.indexOf("ACTIVATE"));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].params).toEqual(expect.arrayContaining([942.82, "INR", "pay_1"]));
    expect(applyPlanTier).toHaveBeenCalledWith("salon1", "basic", "owner1");
    expect(emailForTransaction).toHaveBeenCalledWith("pay_1");   // the owner gets the invoice they would have got from the webhook
  });

  it("still activates when the payment can't be found (access matters most), without inventing a payment", async () => {
    const id = nextId();
    pendingRows = [{ rzp: id }];
    fetchSub.mockResolvedValue(rzpSub(id, "active"));
    listInvoices.mockResolvedValue({ items: [] });

    expect(await subscriptionCheckoutService.reconcilePending("user1", "salon1")).toBe(1);

    expect(statements).toContain("ACTIVATE");
    expect(inserted).toHaveLength(0);
    expect(applyPlanTier).toHaveBeenCalledTimes(1);   // via the "activated" path, exactly once
  });

  it("leaves a checkout alone while Razorpay still says it is unpaid", async () => {
    const id = nextId();
    pendingRows = [{ rzp: id }];
    fetchSub.mockResolvedValue(rzpSub(id, "created"));

    expect(await subscriptionCheckoutService.reconcilePending("user1", null)).toBe(0);

    expect(statements).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(applyPlanTier).not.toHaveBeenCalled();
  });

  it("asks Razorpay about the same subscription at most once per interval", async () => {
    const id = nextId();
    pendingRows = [{ rzp: id }];
    fetchSub.mockResolvedValue(rzpSub(id, "created"));

    await subscriptionCheckoutService.reconcilePending("user1", "salon1");
    await subscriptionCheckoutService.reconcilePending("user1", "salon1");
    await subscriptionCheckoutService.reconcilePending("user1", "salon1");

    expect(fetchSub).toHaveBeenCalledTimes(1);
  });

  it("never throws: a Razorpay error (or a DB error) must not break the page that asked", async () => {
    const id = nextId();
    pendingRows = [{ rzp: id }];
    fetchSub.mockRejectedValue({ error: { description: "The id provided does not exist" } });
    await expect(subscriptionCheckoutService.reconcilePending("user1", "salon1")).resolves.toBe(0);

    poolQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(subscriptionCheckoutService.reconcilePending("user1", "salon1")).resolves.toBe(0);
  });

  it("does nothing when there is nothing pending (the common case): no Razorpay call", async () => {
    pendingRows = [];
    expect(await subscriptionCheckoutService.reconcilePending("user1", "salon1")).toBe(0);
    expect(fetchSub).not.toHaveBeenCalled();
  });

  it("is idempotent with the real webhook arriving afterwards (the payment is de-duplicated by Razorpay payment id)", async () => {
    const id = nextId();
    pendingRows = [{ rzp: id }];
    fetchSub.mockResolvedValue(rzpSub(id, "active"));
    await subscriptionCheckoutService.reconcilePending("user1", "salon1");
    expect(inserted).toHaveLength(1);

    // The late webhook for the same event: the payments table already has pay_1.
    clientQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));   // BEGIN
    clientQuery.mockImplementationOnce(async () => ({ rows: [{ id: "s1", salon_id: "salon1", status: "active" }], rowCount: 1 }));   // row lookup
    clientQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));   // close other live subs
    clientQuery.mockImplementationOnce(async () => ({ rows: [], rowCount: 1 }));   // set active
    clientQuery.mockImplementationOnce(async () => ({ rows: [{ x: 1 }], rowCount: 1 }));   // payment already stored
    await subscriptionCheckoutService.handleWebhook({
      event: "subscription.charged",
      payload: { subscription: { entity: rzpSub(id, "active") }, payment: { entity: rzpPayment } },
    });
    expect(inserted).toHaveLength(1);
  });
});

describe("attachPendingToSalon: paid before the salon existed", () => {
  it("applies the paid plan's features to the new salon", async () => {
    attachedRows = [{ id: "s1", status: "active" }];

    expect(await subscriptionCheckoutService.attachPendingToSalon("owner1", "salon1")).toBe(1);

    expect(applyPlanTier).toHaveBeenCalledWith("salon1", "basic", "owner1");
  });

  it("does not touch the salon's features when the attached checkout is still unpaid", async () => {
    attachedRows = [{ id: "s1", status: "created" }];

    expect(await subscriptionCheckoutService.attachPendingToSalon("owner1", "salon1")).toBe(1);

    expect(applyPlanTier).not.toHaveBeenCalled();
  });

  it("a failure applying features never blocks onboarding", async () => {
    attachedRows = [{ id: "s1", status: "active" }];
    applyPlanTier.mockRejectedValueOnce(new Error("boom"));

    await expect(subscriptionCheckoutService.attachPendingToSalon("owner1", "salon1")).resolves.toBe(1);
  });
});
