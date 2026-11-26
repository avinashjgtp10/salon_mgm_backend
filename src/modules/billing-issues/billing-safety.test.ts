// Regression tests for the subscription billing safety fixes: who may touch a salon's billing, what a late or repeated
// Razorpay event may change, and what happens to money that can't be applied.

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
let subRow: Record<string, unknown> = {};
let replacedRows: { razorpay_subscription_id: string | null }[] = [];
let owned = false;
let assigned = false;
let refundPayment: { salon_id: string } | null = null;

const answer = (sql: string, params: unknown[] = []) => {
  const s = String(sql).trim();
  calls.push({ sql: s, params });
  if (/FROM subscriptions WHERE razorpay_subscription_id = \$1 FOR UPDATE/.test(s)) return { rows: [subRow], rowCount: 1 };
  if (/^UPDATE subscriptions SET status = 'cancelled'.*RETURNING razorpay_subscription_id/s.test(s)) return { rows: replacedRows, rowCount: replacedRows.length };
  if (/^INSERT INTO subscription_payments/.test(s)) return { rows: [{ id: "pay_row" }], rowCount: 1 };
  if (/FROM salons WHERE id = \$1 AND owner_id/.test(s)) return { rows: owned ? [{}] : [], rowCount: owned ? 1 : 0 };
  if (/FROM branch_owner_salons/.test(s)) return { rows: assigned ? [{}] : [], rowCount: assigned ? 1 : 0 };
  if (/FROM subscription_payments p LEFT JOIN subscriptions s/.test(s)) return { rows: refundPayment ? [refundPayment] : [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
};
const query = jest.fn(async (sql: string, params?: unknown[]) => answer(sql, params));
const cancel = jest.fn().mockResolvedValue({});
const generateInvoice = jest.fn().mockResolvedValue(null);

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (s: string, p?: unknown[]) => query(s, p), connect: () => Promise.resolve({ query, release: jest.fn() }) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: null, keySecret: null, webhookSecret: null }),
  getRazorpay: async () => ({ subscriptions: { cancel: (...a: unknown[]) => cancel(...a) } }), createRazorpayPlan: jest.fn(), razorpayBilling: jest.fn(),
}));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({
  subscriptionInvoicesService: { generateForPaymentTx: (...a: unknown[]) => generateInvoice(...a), emailForTransaction: jest.fn().mockResolvedValue(undefined), billAllUnbilledForSalon: jest.fn() },
}));
jest.mock("../subscription-upgrade/subscription-upgrade.service", () => ({ subscriptionUpgradeService: {} }));
jest.mock("../subscription-durations/subscription-durations.service", () => ({ subscriptionDurationsService: { handleGatewayEvent: jest.fn().mockResolvedValue("order route") } }));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: { applyPlanTier: jest.fn() } }));
jest.mock("../subscriptions/subscription-plan-change.service", () => ({ subscriptionPlanChangeService: { onAuthenticated: jest.fn() } }));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(true) }));

import { subscriptionCheckoutService } from "../subscriptions/subscription-checkout.service";
import { canAccessSalon } from "../../middleware/salon-access";
import { stopRecurring } from "./billing-issues";

const SALON = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const CLOSED_AT = new Date("2026-11-10T00:00:00Z");
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const event = (type: string, paidAt?: string) => ({
  event: type,
  payload: {
    subscription: { entity: { id: "sub_old", current_start: 1790000000, current_end: 1792600000 } },
    ...(paidAt ? { payment: { entity: { id: "pay_1", status: "captured", amount: 100000, currency: "INR", created_at: unix(paidAt) } } } : {}),
  },
});
const ran = (re: RegExp) => calls.filter((c) => re.test(c.sql));
const issues = () => ran(/^INSERT INTO subscription_billing_issues/).map((c) => c.params[0]);

beforeEach(() => {
  calls.length = 0; jest.clearAllMocks(); replacedRows = []; owned = false; assigned = false; refundPayment = null;
  subRow = { id: "s1", salon_id: SALON, status: "cancelled", cancelled_at: CLOSED_AT, created_at: new Date("2026-10-01T00:00:00Z") };
});

describe("who may use a salon's billing", () => {
  it("refuses another salon, whatever the role", async () => {
    for (const role of ["salon_owner", "admin", "staff", "branch_owner"]) {
      expect(await canAccessSalon({ userId: "u1", role, salonId: SALON }, OTHER)).toBe(false);
    }
  });
  it("lets staff view their own salon but not do owner-only actions", async () => {
    const staff = { userId: "u1", role: "staff", salonId: SALON };
    expect(await canAccessSalon(staff, SALON)).toBe(true);
    expect(await canAccessSalon(staff, SALON, { ownerOnly: true })).toBe(false);
  });
  it("allows the owner on record, an assigned branch owner and a super admin", async () => {
    owned = true;
    expect(await canAccessSalon({ userId: "u1", role: "salon_owner" }, OTHER, { ownerOnly: true })).toBe(true);
    owned = false; assigned = true;
    expect(await canAccessSalon({ userId: "u2", role: "branch_owner" }, OTHER)).toBe(true);
    expect(await canAccessSalon({ userId: "u3", role: "super_admin" }, OTHER, { ownerOnly: true })).toBe(true);
  });
});

describe("late and repeated Razorpay events", () => {
  it.each(["subscription.activated", "subscription.authenticated", "subscription.halted", "subscription.resumed"])("%s cannot reopen a cancelled subscription", async (type) => {
    await subscriptionCheckoutService.handleWebhook(event(type));
    expect(ran(/^UPDATE subscriptions/)).toHaveLength(0);
  });

  it("a payment taken before the cancellation is recorded normally, without reopening it", async () => {
    await subscriptionCheckoutService.handleWebhook(event("subscription.charged", "2026-11-09T00:00:00Z"));
    expect(ran(/^INSERT INTO subscription_payments/)[0].sql).toContain("'paid'");
    expect(generateInvoice).toHaveBeenCalled();
    expect(ran(/^UPDATE subscriptions/)).toHaveLength(0);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("a charge after the subscription was replaced is kept for review, not invoiced, and Razorpay is told to stop", async () => {
    subRow.status = "upgraded"; subRow.cancelled_at = null; subRow.updated_at = CLOSED_AT;
    await subscriptionCheckoutService.handleWebhook(event("subscription.charged", "2026-11-20T00:00:00Z"));
    expect(ran(/^INSERT INTO subscription_payments/)[0].sql).toContain("'needs_review'");
    expect(generateInvoice).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith("sub_old", false);
    expect(issues()).toEqual(["late_charge"]);
  });

  it("a new activation stops the replaced automatic payment in Razorpay, after the commit", async () => {
    subRow.status = "created";
    replacedRows = [{ razorpay_subscription_id: "sub_previous" }, { razorpay_subscription_id: null }];
    await subscriptionCheckoutService.handleWebhook(event("subscription.activated"));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("sub_previous", false);
  });

  it("a renewal only replaces rows older than itself", async () => {
    subRow.status = "active";
    await subscriptionCheckoutService.handleWebhook(event("subscription.activated"));
    expect(ran(/^UPDATE subscriptions SET status = 'cancelled'.*RETURNING/s)[0].sql).toContain("created_at <");
  });
});

describe("stopping a subscription", () => {
  it("records a failed stop for review", async () => {
    cancel.mockRejectedValueOnce({ error: { description: "Too many requests" } });
    expect(await stopRecurring("sub_x", true, SALON)).toBe(false);
    expect(issues()).toEqual(["stop_failed"]);
  });
  it("treats an already cancelled one as stopped", async () => {
    cancel.mockRejectedValueOnce({ error: { description: "Subscription is already cancelled" } });
    expect(await stopRecurring("sub_x", true, SALON)).toBe(true);
    expect(issues()).toEqual([]);
  });
  it("cancels outright when there is no billing cycle to wait for", async () => {
    cancel.mockRejectedValueOnce({ error: { description: "Cannot cancel at cycle end, no billing cycle is going on" } });
    expect(await stopRecurring("sub_x", true, SALON)).toBe(true);
    expect(cancel).toHaveBeenLastCalledWith("sub_x", false);
  });
});

describe("refunds", () => {
  const refund = { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 50000, currency: "INR" } }, payment: { entity: { id: "pay_1", order_id: "order_1" } } } };
  it("records a subscription refund and leaves access alone", async () => {
    refundPayment = { salon_id: SALON };
    expect(await subscriptionCheckoutService.handleWebhook(refund)).toBe("refund recorded");
    expect(issues()).toEqual(["refund"]);
    expect(ran(/^UPDATE subscription/)).toHaveLength(0);
  });
  it("ignores a refund of some other payment", async () => {
    expect(await subscriptionCheckoutService.handleWebhook(refund)).toMatch(/^ignored/);
    expect(issues()).toEqual([]);
  });
});
