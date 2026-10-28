// Checkout: Indian (INR) customers are unaffected; a customer whose own currency can't be charged is never silently billed in INR. They get
// a 409 CURRENCY_NOT_ENABLED with alternatives, and INR billing happens only with a server-signed consent token bound to exactly that
// offer. Also: tampering, a missing country, monthly vs yearly, and Razorpay failures.

import jwt from "jsonwebtoken";

const poolQuery = jest.fn();
const quoteMock = jest.fn();
const resolvePlan = jest.fn();
const createSub = jest.fn();
let schemaReady = true;

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: unknown[]) => poolQuery(...a) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }),
  getRazorpay: () => ({ subscriptions: { create: (...a: unknown[]) => createSub(...a) } }),
  createRazorpayPlan: jest.fn(),
  razorpayBilling: jest.fn(),
}));
jest.mock("../subscription-invoices/subscription-invoices.service", () => ({ subscriptionInvoicesService: { generateForPaymentTx: jest.fn(), emailForTransaction: jest.fn(), billAllUnbilledForSalon: jest.fn() } }));
jest.mock("../subscription-upgrade/subscription-upgrade.service", () => ({ subscriptionUpgradeService: {} }));
jest.mock("../salon-modules/salon-modules.service", () => ({ salonModulesService: {} }));
jest.mock("../subscription-billing/plan-tier", () => ({ tierOfPlan: jest.fn() }));
jest.mock("./subscription-plan-change.service", () => ({ subscriptionPlanChangeService: { onAuthenticated: jest.fn().mockResolvedValue(undefined) } }));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(schemaReady) }));
jest.mock("../subscription-pricing/razorpay-plans", () => ({ resolveRazorpayPlan: (...a: unknown[]) => resolvePlan(...a) }));
jest.mock("../subscription-pricing/pricing.service", () => ({
  ...jest.requireActual("../subscription-pricing/pricing.service"),
  subscriptionPricingService: { quote: (...a: unknown[]) => quoteMock(...a) },
}));

import { subscriptionCheckoutService } from "./subscription-checkout.service";
import { buildQuote, clearRefusedCurrencies, type BasePlan } from "../subscription-pricing/pricing.service";

process.env.JWT_ACCESS_SECRET = "unit-test-secret";
const USER = "user-1";
const rates = { rates: { INR: 1, USD: 0.0105, AED: 0.0386 }, fetchedAt: new Date("2026-10-28T00:00:00Z") };
const plan = (cycle: "monthly" | "yearly", price: number): BasePlan => ({ id: `plan-${cycle}`, slug: `salonox-basic-${cycle}`, tier: "basic", cycle, name: "SalonOx Basic", price, razorpay_plan_id: "plan_x", razorpay_amount: null });
const monthly = plan("monthly", 799);
const yearly = plan("yearly", 7999);

/** Quote the way the real service does, with a chosen set of enabled charge currencies. */
const quoteFor = (base: BasePlan, enabled: string[] = ["INR"]) => quoteMock.mockImplementation(async (_t: string, _c: string, country: string) => ({
  base, quote: buildQuote(base, country, rates, new Set(enabled)),
}));
const inserts = () => poolQuery.mock.calls.filter(([sql]) => /INSERT INTO subscriptions/.test(String(sql)));
const accountCountry = (user: string | null, salon: string | null = null) => poolQuery.mockImplementation(async (sql: string) =>
  /FROM users u/.test(sql) ? { rows: [{ user_country: user, salon_country: salon }] } : { rows: [], rowCount: 1 });

beforeEach(() => {
  jest.clearAllMocks();
  clearRefusedCurrencies();
  schemaReady = true;
  resolvePlan.mockResolvedValue("plan_RZP");
  createSub.mockResolvedValue({ id: "sub_1", short_url: "https://rzp.io/x" });
  accountCountry(null);
});

describe("Indian customers (INR) are unchanged", () => {
  it("creates the subscription straight away, in INR, with no consent step", async () => {
    quoteFor(monthly);
    const r = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "IN");
    expect(r.charge).toMatchObject({ currency: "INR", total: 942.82, fallback: false });
    expect(r.consent_recorded).toBe(false);
    expect(resolvePlan).toHaveBeenCalledWith(expect.objectContaining({ slug: "salonox-basic-monthly" }), "INR", 942.82, 1);
    expect(createSub).toHaveBeenCalledWith(expect.objectContaining({ plan_id: "plan_RZP", total_count: 120 }));
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0][1]).toEqual(expect.arrayContaining(["IN", "INR", 942.82]));
  });

  it("monthly and yearly use their own price and renewal count", async () => {
    quoteFor(yearly);
    const y = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "yearly", "IN");
    expect(y.charge.total).toBe(9438.82);
    expect(createSub).toHaveBeenCalledWith(expect.objectContaining({ total_count: 10 }));
  });
});

describe("unsupported currency: explicit consent, never a silent fallback", () => {
  const ask = () => subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", undefined);
  const offerOf = async () => { try { await ask(); } catch (e: any) { return e; } throw new Error("expected a 409"); };

  it("answers 409 CURRENCY_NOT_ENABLED with alternatives, and creates nothing", async () => {
    quoteFor(monthly);
    const e = await offerOf();
    expect(e).toMatchObject({ statusCode: 409, code: "CURRENCY_NOT_ENABLED" });
    expect(e.details).toMatchObject({ requested_currency: "USD", country: "US", consent_status: "missing" });
    const kinds = e.details.alternatives.map((a: any) => a.type);
    expect(kinds).toEqual(["continue_in_inr", "change_country", "contact_support"]);
    const inr = e.details.alternatives[0];
    expect(inr).toMatchObject({ currency: "INR", total: 942.82, tax: 143.82 });
    expect(typeof inr.consent_token).toBe("string");
    expect(createSub).not.toHaveBeenCalled();
    expect(resolvePlan).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);
  });

  it("with the server's token the INR subscription is created, and the consent is recorded", async () => {
    quoteFor(monthly);
    const token = (await offerOf()).details.alternatives[0].consent_token;
    const r = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", token);
    expect(r.charge).toMatchObject({ currency: "INR", total: 942.82, fallback: true });
    expect(r.consent_recorded).toBe(true);
    expect(resolvePlan).toHaveBeenCalledWith(expect.anything(), "INR", 942.82, 1);
    const params = inserts()[0][1] as unknown[];
    expect(params).toEqual(expect.arrayContaining(["US", "USD", "INR", 942.82]));
    expect(params.slice(-3)).toEqual([expect.any(Date), "USD", 942.82]);          // consent time, requested currency, agreed amount
  });

  it("a boolean flag, a made-up token or nothing is never accepted as consent", async () => {
    quoteFor(monthly);
    for (const bad of [true, "true", "yes", 1, "abc.def.ghi", {}]) {
      await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", bad)).rejects.toMatchObject({ code: "CURRENCY_NOT_ENABLED" });
    }
    expect(createSub).not.toHaveBeenCalled();
  });

  it("a forged or tampered token is refused", async () => {
    quoteFor(monthly);
    const token = (await offerOf()).details.alternatives[0].consent_token;
    const forged = jwt.sign({ purpose: "currency_fallback", uid: USER, tier: "basic", cycle: "monthly", country: "US", req: "USD", cur: "INR", amt: 1 }, "some-other-secret");
    const tampered = token.slice(0, -3) + (token.endsWith("aaa") ? "bbb" : "aaa");
    for (const t of [forged, tampered]) {
      await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", t)).rejects.toMatchObject({ code: "CURRENCY_NOT_ENABLED", details: { consent_status: "invalid" } });
    }
    expect(createSub).not.toHaveBeenCalled();
  });

  it("an expired token is refused with a fresh offer", async () => {
    quoteFor(monthly);
    const expired = jwt.sign({ purpose: "currency_fallback", uid: USER, tier: "basic", cycle: "monthly", country: "US", req: "USD", cur: "INR", amt: 942.82 }, "unit-test-secret", { expiresIn: -60 });
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", expired)).rejects.toMatchObject({ details: { consent_status: "expired" } });
    expect(createSub).not.toHaveBeenCalled();
  });

  it("a token is bound to the user, plan, cycle and country it was issued for", async () => {
    quoteFor(monthly);
    const token = (await offerOf()).details.alternatives[0].consent_token;
    const attempts: [string, string, string, string][] = [
      ["someone-else", "basic", "monthly", "US"],   // another user
      [USER, "growth", "monthly", "US"],             // another plan
      [USER, "basic", "yearly", "US"],               // another cycle
      [USER, "basic", "monthly", "GB"],              // another country
    ];
    for (const [uid, tier, cycle, country] of attempts) {
      quoteFor(plan(cycle as "monthly" | "yearly", cycle === "yearly" ? 7999 : 799));
      await expect(subscriptionCheckoutService.createCheckout(null, uid, tier, cycle, country, token)).rejects.toMatchObject({ code: "CURRENCY_NOT_ENABLED", details: { consent_status: "mismatch" } });
    }
    expect(createSub).not.toHaveBeenCalled();
  });

  it("if the price changed since the customer agreed, the old consent no longer counts", async () => {
    quoteFor(monthly);
    const token = (await offerOf()).details.alternatives[0].consent_token;
    quoteFor(plan("monthly", 899));                      // Super Admin raised the price after the offer
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", token)).rejects.toMatchObject({ details: { consent_status: "mismatch" } });
    expect(createSub).not.toHaveBeenCalled();
  });

  it("the unavailable-rate case needs consent too", async () => {
    quoteMock.mockImplementation(async () => ({ base: monthly, quote: buildQuote(monthly, "GB", null, new Set(["INR", "GBP"])) }));
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "GB")).rejects.toMatchObject({ code: "CURRENCY_NOT_ENABLED", details: { requested_currency: "GBP" } });
  });

  it("when the customer's currency IS enabled, they are charged in it and no consent is needed", async () => {
    quoteFor(monthly, ["INR", "USD"]);
    const r = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US");
    expect(r.charge).toMatchObject({ currency: "USD", total: 8.39, fallback: false });
    expect(r.consent_recorded).toBe(false);
    expect(resolvePlan).toHaveBeenCalledWith(expect.anything(), "USD", 8.39, expect.any(Number));
  });
});

describe("country handling", () => {
  it("a country that is not on the request comes from the account, then the salon, and finally defaults to India", async () => {
    quoteFor(monthly);
    accountCountry("US");
    await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", undefined).catch(() => undefined);
    expect(quoteMock).toHaveBeenLastCalledWith("basic", "monthly", "US");
    accountCountry(null, "gb");
    await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", undefined).catch(() => undefined);
    expect(quoteMock).toHaveBeenLastCalledWith("basic", "monthly", "GB");
    accountCountry(null, null);
    await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", undefined);
    expect(quoteMock).toHaveBeenLastCalledWith("basic", "monthly", "IN");
  });

  it("an invalid country on the request is ignored in favour of the account's", async () => {
    quoteFor(monthly);
    accountCountry("US");
    await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "not-a-country").catch(() => undefined);
    expect(quoteMock).toHaveBeenLastCalledWith("basic", "monthly", "US");
  });

  it("rejects an invalid plan or cycle before doing anything", async () => {
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "gold", "monthly", "IN")).rejects.toMatchObject({ statusCode: 400 });
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "weekly", "IN")).rejects.toMatchObject({ statusCode: 400 });
    expect(quoteMock).not.toHaveBeenCalled();
  });
});

describe("Razorpay failures", () => {
  it("a failed subscription create is a 502 and nothing is stored", async () => {
    quoteFor(monthly);
    createSub.mockRejectedValue({ statusCode: 400, error: { description: "plan is not active" } });
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "IN")).rejects.toMatchObject({ statusCode: 502, code: "RAZORPAY_ERROR" });
    expect(inserts()).toHaveLength(0);
  });

  it("a timeout is a 502 and nothing is stored", async () => {
    quoteFor(monthly);
    createSub.mockRejectedValue(new Error("timeout of 10000ms exceeded"));
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "IN")).rejects.toMatchObject({ statusCode: 502 });
    expect(inserts()).toHaveLength(0);
  });

  it("a rate limit while resolving the plan stops the checkout without creating a subscription", async () => {
    quoteFor(monthly);
    resolvePlan.mockRejectedValue(Object.assign(new Error("busy"), { statusCode: 503, code: "RAZORPAY_RATE_LIMITED" }));
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "IN")).rejects.toMatchObject({ code: "RAZORPAY_RATE_LIMITED" });
    expect(createSub).not.toHaveBeenCalled();
  });

  it("without the country/currency columns it falls back to the original INSERT (INR-only databases keep working)", async () => {
    schemaReady = false;
    quoteFor(monthly);
    await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "IN");
    const sql = String(inserts()[0][0]);
    expect(sql).not.toMatch(/country_code|currency_consent/);
  });
});

describe("auto mode: the customer's own currency comes from their country; Razorpay decides", () => {
  const refuse = (currency: string) => resolvePlan.mockImplementation(async (_b: unknown, cur: string) => {
    if (cur === currency) throw Object.assign(new Error("Subscriptions in " + cur + " are not available"), { statusCode: 409, code: "CURRENCY_NOT_SUPPORTED" });
    return "plan_RZP";
  });

  it("any country is charged in its own currency without a per-country setting", async () => {
    quoteFor(monthly, ["INR", "*"]);
    for (const [country, currency] of [["US", "USD"], ["AE", "AED"]] as const) {
      const r = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", country);
      expect(r.charge.currency).toBe(currency);
      expect(r.consent_recorded).toBe(false);
    }
  });

  it("when Razorpay refuses that currency the customer gets the INR consent offer (not an error), nothing is created, and the currency is skipped next time", async () => {
    quoteFor(monthly, ["INR", "*"]);
    refuse("USD");
    const offer: any = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US").catch((e) => e);
    expect(offer).toMatchObject({ statusCode: 409, code: "CURRENCY_NOT_ENABLED", details: { requested_currency: "USD" } });
    expect(offer.details.alternatives.map((a: any) => a.type)).toEqual(["continue_in_inr", "change_country", "contact_support"]);
    expect(createSub).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);

    resolvePlan.mockClear();
    const again: any = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US").catch((e) => e);
    expect(again.code).toBe("CURRENCY_NOT_ENABLED");
    expect(resolvePlan).not.toHaveBeenCalled();                       // not asked again

    const r = await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "US", again.details.alternatives[0].consent_token);
    expect(r.charge).toMatchObject({ currency: "INR", fallback: true });
    expect(r.consent_recorded).toBe(true);
    expect(await subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "AE")).toMatchObject({ charge: { currency: "AED" } });
  });

  it("an INR failure is never turned into a consent offer", async () => {
    quoteFor(monthly, ["INR", "*"]);
    resolvePlan.mockRejectedValue(Object.assign(new Error("busy"), { statusCode: 503, code: "RAZORPAY_RATE_LIMITED" }));
    await expect(subscriptionCheckoutService.createCheckout(null, USER, "basic", "monthly", "IN")).rejects.toMatchObject({ code: "RAZORPAY_RATE_LIMITED" });
  });
});
