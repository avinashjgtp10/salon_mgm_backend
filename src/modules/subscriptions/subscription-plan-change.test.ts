// Changing the plan of a subscription billed in a currency other than INR: the in-place upgrade is refused; the change is scheduled as a NEW
// subscription starting when the current period ends, only after the customer confirmed what will happen. The current subscription is not
// touched until the new one is authorised, and then it is only set to stop at its cycle end, so there is never a second active subscription
// or a double charge.

import jwt from "jsonwebtoken";

const poolQuery = jest.fn();
const quoteMock = jest.fn();
const resolvePlan = jest.fn();
const rzpCreate = jest.fn();
const rzpFetch = jest.fn();
const rzpCancel = jest.fn();
let schemaReady = true;

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: unknown[]) => poolQuery(...a), connect: jest.fn() } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }),
  getRazorpay: () => ({ subscriptions: { create: (...a: unknown[]) => rzpCreate(...a), fetch: (...a: unknown[]) => rzpFetch(...a), cancel: (...a: unknown[]) => rzpCancel(...a) } }),
  createRazorpayPlan: jest.fn(),
  razorpayBilling: jest.fn(),
}));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(schemaReady) }));
jest.mock("../subscription-pricing/razorpay-plans", () => ({ resolveRazorpayPlan: (...a: unknown[]) => resolvePlan(...a) }));
jest.mock("../subscription-pricing/pricing.service", () => ({
  ...jest.requireActual("../subscription-pricing/pricing.service"),
  subscriptionPricingService: { quote: (...a: unknown[]) => quoteMock(...a) },
}));
// the upgrade module pulls in many billing services; only the guard is under test here
jest.mock("../subscription-invoices/subscription-invoices.repository", () => ({ subscriptionInvoicesRepository: {} }));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({ subscriptionInvoicesService: {} }));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: {} }));
jest.mock("../subscription-billing/subscription-billing.service", () => ({ loadPaidInfo: jest.fn(), loadSalonSubscriptions: jest.fn(), pickCurrentSubscription: jest.fn(), subscriptionEnd: jest.fn() }));

import { subscriptionPlanChangeService } from "./subscription-plan-change.service";
import { assertInrSubscription } from "../subscription-upgrade/subscription-upgrade.service";
import { buildQuote, type BasePlan } from "../subscription-pricing/pricing.service";

process.env.JWT_ACCESS_SECRET = "unit-test-secret";
const USER = "user-1";
const SALON = "salon-1";
const rates = { rates: { INR: 1, USD: 0.0105 }, fetchedAt: new Date("2026-10-28T00:00:00Z") };
const mk = (tier: "basic" | "advance" | "growth", price: number): BasePlan => ({ id: `plan-${tier}-monthly`, slug: `salonox-${tier}-monthly`, tier, cycle: "monthly", name: `SalonOx ${tier}`, price, razorpay_plan_id: null, razorpay_amount: null });
const advance = mk("advance", 999);
const growth = mk("growth", 1299);
const periodEnd = new Date(Date.now() + 20 * 24 * 3600 * 1000);

const current = (over: Record<string, unknown> = {}) => ({
  id: "sub-old", plan_id: "plan-basic-monthly", razorpay_subscription_id: "sub_old_rzp", current_period_end: periodEnd.toISOString(),
  charged_currency: "USD", charged_amount: "8.39", country_code: "US", slug: "salonox-basic-monthly", plan_name: "SalonOx Basic", ...over,
});
let currentRow: any = current();
let pendingRow: any = undefined;
const target = (base: BasePlan, enabled = ["INR", "USD"]) => quoteMock.mockImplementation(async (_t: string, _c: string, country: string) => ({ base, quote: buildQuote(base, country, rates, new Set(enabled)) }));

beforeEach(() => {
  jest.clearAllMocks();
  schemaReady = true;
  currentRow = current();
  pendingRow = undefined;
  target(advance);
  resolvePlan.mockResolvedValue("plan_USD_ADV");
  rzpCreate.mockResolvedValue({ id: "sub_new_rzp", short_url: "https://rzp.io/new" });
  rzpFetch.mockResolvedValue({ short_url: "https://rzp.io/pending" });
  rzpCancel.mockResolvedValue({ status: "active" });
  poolQuery.mockImplementation(async (sql: string) => {
    if (/WHERE s\.salon_id = \$1 AND s\.status = 'active'/.test(sql)) return { rows: currentRow ? [currentRow] : [] };
    if (/WHERE replaces_subscription_id = \$1/.test(sql)) return { rows: pendingRow ? [pendingRow] : [] };
    return { rows: [], rowCount: 1 };
  });
});

const confirmationOf = async (tier = "advance") => {
  try { await subscriptionPlanChangeService.schedule(SALON, USER, tier, "monthly"); } catch (e: any) { return e; }
  throw new Error("expected a 409");
};
const writes = (re: RegExp) => poolQuery.mock.calls.filter(([sql]) => re.test(String(sql)));

describe("the in-place upgrade refuses non-INR subscriptions", () => {
  it("a USD subscription cannot be upgraded in place", async () => {
    poolQuery.mockResolvedValue({ rows: [{ charged_currency: "USD" }] });
    await expect(assertInrSubscription({ query: poolQuery } as never, "sub-old", periodEnd)).rejects.toMatchObject({
      statusCode: 409, code: "CURRENCY_UPGRADE_UNSUPPORTED",
      details: { current_currency: "USD", alternatives: [{ type: "schedule_plan_change" }, { type: "contact_support" }] },
    });
  });
  it("INR and older subscriptions (no currency recorded) go through the normal upgrade flow", async () => {
    for (const rows of [[{ charged_currency: "INR" }], [{ charged_currency: null }], []]) {
      poolQuery.mockResolvedValue({ rows });
      await expect(assertInrSubscription({ query: poolQuery } as never, "sub-old", periodEnd)).resolves.toBeUndefined();
    }
  });
  it("databases without the currency columns behave as before", async () => {
    schemaReady = false;
    await expect(assertInrSubscription({ query: poolQuery } as never, "sub-old", periodEnd)).resolves.toBeUndefined();
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe("scheduling a plan change", () => {
  it("only applies to salons that have an active subscription, and to valid plans", async () => {
    currentRow = null;
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly")).rejects.toMatchObject({ code: "NO_SUBSCRIPTION" });
    await expect(subscriptionPlanChangeService.schedule(null, USER, "advance", "monthly")).rejects.toMatchObject({ statusCode: 403 });
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "gold", "monthly")).rejects.toMatchObject({ statusCode: 400 });
    expect(rzpCreate).not.toHaveBeenCalled();
  });

  it("first asks for confirmation: what will happen, when, at what price, and a signed token. Nothing is created", async () => {
    const e = await confirmationOf();
    expect(e).toMatchObject({ statusCode: 409, code: "PLAN_CHANGE_CONFIRMATION_REQUIRED" });
    expect(e.details).toMatchObject({
      consent_status: "missing",
      current: { plan_name: "SalonOx Basic", currency: "USD", amount: 8.39, ends_at: periodEnd.toISOString() },
      next: { tier: "advance", cycle: "monthly", currency: "USD", amount: 10.49, starts_at: periodEnd.toISOString() },
    });
    expect(typeof e.details.confirmation_token).toBe("string");
    expect(e.message).toMatch(/stays active until then/);
    expect(rzpCreate).not.toHaveBeenCalled();
    expect(writes(/INSERT INTO subscriptions|UPDATE subscriptions/)).toHaveLength(0);
    expect(rzpCancel).not.toHaveBeenCalled();
  });

  it("with the confirmation it creates a NEW subscription that starts when the current period ends, and leaves the current one alone", async () => {
    const token = (await confirmationOf()).details.confirmation_token;
    const r = await subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", token);
    expect(r).toMatchObject({ short_url: "https://rzp.io/new", razorpay_subscription_id: "sub_new_rzp", starts_at: periodEnd.toISOString(), already_pending: false });
    expect(resolvePlan).toHaveBeenCalledWith(expect.objectContaining({ slug: "salonox-advance-monthly" }), "USD", 10.49, expect.any(Number));
    expect(rzpCreate).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: "plan_USD_ADV", start_at: Math.floor(periodEnd.getTime() / 1000), notes: expect.objectContaining({ replaces: "sub_old_rzp", charge_currency: "USD" }),
    }));
    const insert = writes(/INSERT INTO subscriptions/)[0];
    expect(insert[1]).toEqual(expect.arrayContaining(["sub-old", "sub_new_rzp", "USD", 10.49]));
    // the current subscription is neither cancelled nor modified while the replacement is not yet authorised
    expect(rzpCancel).not.toHaveBeenCalled();
    expect(writes(/UPDATE subscriptions/)).toHaveLength(0);
  });

  it("charges nothing and creates nothing for a forged, expired or mismatched confirmation", async () => {
    const good = (await confirmationOf()).details.confirmation_token;
    const growthToken = (() => { target(growth); return confirmationOf("growth"); })();
    const forThisUserOnly = (await growthToken).details.confirmation_token;
    target(advance);
    const expired = jwt.sign({ purpose: "plan_change", uid: USER, sub: "sub-old", tier: "advance", cycle: "monthly", cur: "USD", amt: 10.49, at: periodEnd.toISOString() }, "unit-test-secret", { expiresIn: -10 });
    const forged = jwt.sign({ purpose: "plan_change", uid: USER, sub: "sub-old", tier: "advance", cycle: "monthly", cur: "USD", amt: 1, at: periodEnd.toISOString() }, "other-secret");
    for (const [token, status] of [[forThisUserOnly, "mismatch"], [expired, "expired"], [forged, "invalid"], [true, "missing"], ["nope", "invalid"]] as [unknown, string][]) {
      await expect(subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", token)).rejects.toMatchObject({ code: "PLAN_CHANGE_CONFIRMATION_REQUIRED", details: { consent_status: status } });
    }
    await expect(subscriptionPlanChangeService.schedule(SALON, "someone-else", "advance", "monthly", good)).rejects.toMatchObject({ details: { consent_status: "mismatch" } });
    expect(rzpCreate).not.toHaveBeenCalled();
  });

  it("refuses the same plan, a change that is too close to the renewal, and a currency that can no longer be charged", async () => {
    target(mk("basic", 799));
    currentRow = current({ plan_id: "plan-basic-monthly" });
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "basic", "monthly")).rejects.toMatchObject({ code: "SAME_PLAN" });

    target(advance);
    currentRow = current({ current_period_end: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly")).rejects.toMatchObject({ code: "PLAN_CHANGE_TOO_LATE" });

    currentRow = current();
    target(advance, ["INR"]);                      // USD no longer enabled: it must NOT switch the customer to INR by itself
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly")).rejects.toMatchObject({ code: "CURRENCY_NOT_ENABLED", details: { current_currency: "USD" } });
    expect(rzpCreate).not.toHaveBeenCalled();
  });

  it("only one replacement can be pending; asking again for the same plan returns the same payment link", async () => {
    const token = (await confirmationOf()).details.confirmation_token;
    pendingRow = { razorpay_subscription_id: "sub_pending", plan_id: "plan-growth-monthly" };
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", token)).rejects.toMatchObject({ code: "PLAN_CHANGE_PENDING" });
    pendingRow = { razorpay_subscription_id: "sub_pending", plan_id: "plan-advance-monthly" };
    const r = await subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", token);
    expect(r).toMatchObject({ short_url: "https://rzp.io/pending", already_pending: true });
    expect(rzpCreate).not.toHaveBeenCalled();
  });

  it("a Razorpay failure creates nothing and leaves the current subscription alone", async () => {
    const token = (await confirmationOf()).details.confirmation_token;
    rzpCreate.mockRejectedValue({ statusCode: 400, error: { description: "start_at must be in the future" } });
    await expect(subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", token)).rejects.toMatchObject({ statusCode: 502, code: "RAZORPAY_ERROR" });
    expect(writes(/INSERT INTO subscriptions|UPDATE subscriptions/)).toHaveLength(0);
    expect(rzpCancel).not.toHaveBeenCalled();
  });
});

describe("scheduling a plan change on an INR subscription (downgrades and shorter billing cycles)", () => {
  const inrCurrent = (slug: string, tier: string, cycle: string, over: Record<string, unknown> = {}) => current({
    charged_currency: "INR", country_code: "IN", charged_amount: null, slug, plan_name: `SalonOx ${tier}`, plan_id: `plan-${tier}-${cycle}`,
    plan_tier: tier, plan_cycle: cycle, ...over,
  });
  const mkCycle = (tier: "basic" | "advance" | "growth", cycle: "monthly" | "quarterly" | "yearly", price: number): BasePlan =>
    ({ ...mk(tier, price), id: `plan-${tier}-${cycle}`, slug: `salonox-${tier}-${cycle}`, cycle });
  const askFor = async (tier: "basic" | "advance" | "growth", cycle: "monthly" | "quarterly" | "yearly", token?: unknown) => {
    try { return await subscriptionPlanChangeService.schedule(SALON, USER, tier, cycle, token); } catch (e: any) { return e; }
  };

  it("Growth monthly -> Advance monthly: priced in INR with GST, nothing charged today, starts when the period ends", async () => {
    currentRow = inrCurrent("salonox-growth-monthly", "growth", "monthly");
    target(mkCycle("advance", "monthly", 999), ["INR"]);
    const e = await askFor("advance", "monthly");
    expect(e).toMatchObject({ code: "PLAN_CHANGE_CONFIRMATION_REQUIRED" });
    expect(e.details.kind).toBe("downgrade");
    expect(e.details.next).toMatchObject({ currency: "INR", subtotal: 999, tax: 179.82, tax_percent: 18, amount: 1178.82, starts_at: periodEnd.toISOString() });
    expect(e.details.current).toMatchObject({ tier: "growth", cycle: "monthly", ends_at: periodEnd.toISOString() });
    expect(e.message).toMatch(/incl\. 18% GST/);
    expect(rzpCreate).not.toHaveBeenCalled();

    const r = await subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", e.details.confirmation_token);
    expect(r).toMatchObject({ starts_at: periodEnd.toISOString(), already_pending: false });
    expect(resolvePlan).toHaveBeenCalledWith(expect.objectContaining({ slug: "salonox-advance-monthly" }), "INR", 999, expect.any(Number));
    expect(rzpCreate).toHaveBeenCalledWith(expect.objectContaining({ start_at: Math.floor(periodEnd.getTime() / 1000) }));
    // the paid plan is left running until its own end date
    expect(rzpCancel).not.toHaveBeenCalled();
    expect(writes(/UPDATE subscriptions/)).toHaveLength(0);
  });

  it("Growth yearly -> Advance monthly: allowed, starts when the paid year ends (no paid time is cut short)", async () => {
    const yearEnd = new Date(Date.now() + 300 * 24 * 3600 * 1000);
    currentRow = inrCurrent("salonox-growth-yearly", "growth", "yearly", { current_period_end: yearEnd.toISOString() });
    target(mkCycle("advance", "monthly", 999), ["INR"]);
    const e = await askFor("advance", "monthly");
    expect(e.details.kind).toBe("downgrade");
    expect(e.details.next.starts_at).toBe(yearEnd.toISOString());
  });

  it("the same plan on a shorter cycle is a billing-cycle change", async () => {
    currentRow = inrCurrent("salonox-advance-yearly", "advance", "yearly");
    target(mkCycle("advance", "monthly", 999), ["INR"]);
    const e = await askFor("advance", "monthly");
    expect(e.details.kind).toBe("cycle_change");
  });

  it("an INR subscription is never moved to another currency, even for a customer in another country", async () => {
    currentRow = inrCurrent("salonox-growth-monthly", "growth", "monthly", { country_code: "US" });
    target(mkCycle("advance", "monthly", 999), ["INR", "USD"]);
    const e = await askFor("advance", "monthly");
    expect(e.details.next.currency).toBe("INR");
    expect(quoteMock).toHaveBeenCalledWith("advance", "monthly", "IN");
  });

  it("a plan assigned by SalonOx (no Razorpay subscription) can also be scheduled: it simply ends on its date", async () => {
    currentRow = inrCurrent("salonox-growth-monthly", "growth", "monthly", { razorpay_subscription_id: null });
    target(mkCycle("advance", "monthly", 999), ["INR"]);
    const e = await askFor("advance", "monthly");
    await subscriptionPlanChangeService.schedule(SALON, USER, "advance", "monthly", e.details.confirmation_token);
    const notes = rzpCreate.mock.calls[0][0].notes;
    expect(notes).not.toHaveProperty("replaces");
  });

  it("still refuses the plan the salon is already on, and a subscription with no end date", async () => {
    currentRow = inrCurrent("salonox-growth-monthly", "growth", "monthly");
    target(mkCycle("growth", "monthly", 1299), ["INR"]);
    expect(await askFor("growth", "monthly")).toMatchObject({ code: "SAME_PLAN" });
    currentRow = inrCurrent("salonox-growth-monthly", "growth", "monthly", { current_period_end: null });
    expect(await askFor("advance", "monthly")).toMatchObject({ code: "NOT_SCHEDULABLE" });
  });
});

describe("after the customer authorises the replacement", () => {
  const replaced = (rows: unknown[]) => poolQuery.mockImplementation(async (sql: string) => (/JOIN subscriptions old/.test(sql) ? { rows } : { rows: [], rowCount: 1 }));

  it("the old subscription is set to end at its cycle end (never immediately) and marked", async () => {
    replaced([{ old_id: "sub-old", old_rzp: "sub_old_rzp" }]);
    await subscriptionPlanChangeService.onAuthenticated("sub_new_rzp");
    expect(rzpCancel).toHaveBeenCalledWith("sub_old_rzp", true);                 // true = at the end of the current cycle
    expect(writes(/SET cancel_at_period_end = TRUE/)[0][1]).toEqual(["sub-old"]);
  });

  it("is safe to repeat; 'already cancelled' / 'no billing cycle' means there is nothing left to cancel", async () => {
    replaced([{ old_id: "sub-old", old_rzp: "sub_old_rzp" }]);
    for (const description of ["The subscription is already cancelled", "Subscription cannot be cancelled since no billing cycle is going on"]) {
      rzpCancel.mockRejectedValue({ error: { description } });
      await expect(subscriptionPlanChangeService.onAuthenticated("sub_new_rzp")).resolves.toBeUndefined();
      await expect(subscriptionPlanChangeService.onAuthenticated("sub_new_rzp")).resolves.toBeUndefined();
    }
    expect(writes(/SET cancel_at_period_end = TRUE/)).toHaveLength(4);
  });

  it("any other Razorpay failure is raised (so the webhook is retried) and the old subscription is NOT marked as ending", async () => {
    replaced([{ old_id: "sub-old", old_rzp: "sub_old_rzp" }]);
    for (const failure of [{ statusCode: 429, error: { description: "Too many requests" } }, new Error("socket hang up"), { statusCode: 500, error: { description: "Internal error" } }]) {
      rzpCancel.mockRejectedValue(failure);
      await expect(subscriptionPlanChangeService.onAuthenticated("sub_new_rzp")).rejects.toMatchObject({ code: "RAZORPAY_ERROR" });
    }
    expect(writes(/SET cancel_at_period_end = TRUE/)).toHaveLength(0);
  });

  it("does nothing for a subscription that replaces nothing (every normal purchase)", async () => {
    replaced([]);
    await subscriptionPlanChangeService.onAuthenticated("sub_plain");
    await subscriptionPlanChangeService.onAuthenticated(undefined);
    expect(rzpCancel).not.toHaveBeenCalled();
  });
});
