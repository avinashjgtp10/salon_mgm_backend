// Country-based plan pricing: the server's price calculation must give the landing page's numbers (INR price x live rate, two
// decimals; India + 18% GST), keep Indian prices exactly as they were, never add GST twice, and only charge a non-INR amount
// for a currency that is explicitly enabled.

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }), getRazorpay: jest.fn(), createRazorpayPlan: jest.fn(), razorpayBilling: jest.fn() }));

import { buildQuote, enabledChargeCurrencies, exponentOf, type BasePlan } from "./pricing.service";
import { parseRates } from "./fx-rates";
import { currencyForCountry } from "./country-currency";

const basic: BasePlan = { id: "p1", slug: "salonox-basic-monthly", tier: "basic", cycle: "monthly", name: "SalonOx Basic", price: 799, razorpay_plan_id: "plan_x", razorpay_amount: 942.82 };
const yearly: BasePlan = { ...basic, id: "p2", slug: "salonox-basic-yearly", cycle: "yearly", price: 7999 };
const rates = { rates: { INR: 1, USD: 0.0105, AED: 0.0386, GBP: 0.0079, JPY: 1.6, KWD: 0.0032 }, fetchedAt: new Date("2026-10-28T00:00:00Z") };
const INR_ONLY = new Set(["INR"]);

describe("country -> currency", () => {
  it("uses the landing page's country list", () => {
    expect(currencyForCountry("in")).toEqual({ country: "IN", currency: "INR" });
    expect(currencyForCountry("US")?.currency).toBe("USD");
    expect(currencyForCountry("AE")?.currency).toBe("AED");
    expect(currencyForCountry("nowhere")).toBeNull();
  });
});

describe("India stays exactly as before", () => {
  it("shows INR + 18% GST and charges the same amount once", () => {
    const q = buildQuote(basic, "IN", rates, INR_ONLY);
    expect(q.display).toMatchObject({ currency: "INR", subtotal: 799, tax: 143.82, total: 942.82, tax_percent: 18, approximate: false, fx_rate: 1 });
    expect(q.charge).toMatchObject({ currency: "INR", subtotal: 799, tax: 143.82, total: 942.82, recurring_amount: 942.82, fallback: false });
    expect(q.base.total).toBe(942.82);
  });
  it("is the same with no exchange rates at all", () => {
    expect(buildQuote(yearly, "IN", null, INR_ONLY).charge.total).toBe(9438.82);
  });
  it("treats a missing or unknown country as India", () => {
    expect(buildQuote(basic, undefined, rates, INR_ONLY).country).toBe("IN");
    expect(buildQuote(basic, "ZZ", rates, INR_ONLY).charge.total).toBe(942.82);
  });
});

describe("international customers", () => {
  it("US: converted price shown without tax; billed in INR until USD is enabled, and says so", () => {
    const q = buildQuote(basic, "US", rates, INR_ONLY);
    expect(q.display).toMatchObject({ currency: "USD", subtotal: 8.39, tax: 0, total: 8.39, approximate: true, tax_note: "excl. applicable taxes" });
    expect(q.charge).toMatchObject({ currency: "INR", total: 942.82, fallback: true });
    expect(q.charge.reason).toMatch(/not enabled/);
  });
  it("US with USD enabled: the charge is the shown USD amount, with no extra tax and no second conversion", () => {
    const q = buildQuote(basic, "US", rates, new Set(["INR", "USD"]));
    expect(q.charge).toMatchObject({ currency: "USD", subtotal: 8.39, tax: 0, total: 8.39, recurring_amount: 8.39, fallback: false, price_locked: false });
  });
  it("AE: yearly converts the INR yearly price (not 12 x monthly)", () => {
    const q = buildQuote(yearly, "AE", rates, new Set(["INR", "AED"]));
    expect(q.display.total).toBe(308.76); // 7999 x 0.0386
    expect(q.charge).toMatchObject({ currency: "AED", total: 308.76, fallback: false });
  });
  it("a held price wins over today's rate", () => {
    const q = buildQuote(basic, "US", rates, new Set(["INR", "USD"]), { currency: "USD", amount: 8.5, fx_rate: 0.01064, razorpay_plan_id: "plan_usd" });
    expect(q.charge).toMatchObject({ currency: "USD", total: 8.5, price_locked: true });
    expect(q.display.total).toBe(8.39);
  });
  it("falls back to INR (with a reason) when the rate is unavailable", () => {
    const q = buildQuote(basic, "GB", null, new Set(["INR", "GBP"]));
    expect(q.display.currency).toBe("INR");
    expect(q.charge).toMatchObject({ currency: "INR", total: 942.82, fallback: true });
    expect(q.charge.reason).toMatch(/rates are unavailable/);
  });
  it("never charges zero- or three-decimal currencies directly", () => {
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf("KWD")).toBe(3);
    const jp = buildQuote(basic, "JP", rates, new Set(["INR", "JPY"]));
    expect(jp.charge).toMatchObject({ currency: "INR", fallback: true });
    expect(jp.charge.reason).toMatch(/cannot be billed directly/);
    const kw = buildQuote(basic, "KW", rates, new Set(["INR", "KWD"]));
    expect(kw.charge.currency).toBe("INR");
  });
});

describe("configuration", () => {
  it("INR is always enabled; the list comes from RAZORPAY_SUBSCRIPTION_CURRENCIES", () => {
    expect([...enabledChargeCurrencies({} as any)]).toEqual(["INR"]);
    expect([...enabledChargeCurrencies({ RAZORPAY_SUBSCRIPTION_CURRENCIES: "usd, aed ,bd,JPYY" } as any)].sort()).toEqual(["AED", "INR", "USD"]);
  });
  it("parses exchange rates with the landing page's rules", () => {
    expect(parseRates({ result: "error" })).toBeNull();
    expect(parseRates({ result: "success", base_code: "USD", rates: { INR: 1 } })).toBeNull();
    expect(parseRates({ result: "success", base_code: "INR", rates: { USD: 0.01, BAD: -1, EUR: "x" } })).toEqual({ INR: 1, USD: 0.01 });
  });
});

describe("which currencies may be charged (no per-country setting needed)", () => {
  const { markCurrencyRefused, clearRefusedCurrencies, isChargeable } = jest.requireActual("./pricing.service");
  beforeEach(() => clearRefusedCurrencies());

  it("'auto' (or '*') allows every currency; an explicit list allows only those", () => {
    expect(enabledChargeCurrencies({ RAZORPAY_SUBSCRIPTION_CURRENCIES: "auto" } as any).has("*")).toBe(true);
    expect(enabledChargeCurrencies({ RAZORPAY_SUBSCRIPTION_CURRENCIES: "*" } as any).has("*")).toBe(true);
    const listed = enabledChargeCurrencies({ RAZORPAY_SUBSCRIPTION_CURRENCIES: "USD", RAZORPAY_KEY_ID: "rzp_test_x" } as any);
    expect([...listed].sort()).toEqual(["INR", "USD"]);                // explicit list wins even on TEST keys
  });

  it("with nothing configured: TEST keys try the customer's own currency, LIVE keys stay INR-only", () => {
    expect(enabledChargeCurrencies({ RAZORPAY_KEY_ID: "rzp_test_x" } as any).has("*")).toBe(true);
    expect([...enabledChargeCurrencies({ RAZORPAY_KEY_ID: "rzp_live_x" } as any)]).toEqual(["INR"]);
    expect([...enabledChargeCurrencies({} as any)]).toEqual(["INR"]);
  });

  it("in auto mode each customer is quoted in their own country's currency, with no configuration per country", () => {
    const auto = new Set(["INR", "*"]);
    expect(buildQuote(basic, "US", rates, auto).charge).toMatchObject({ currency: "USD", total: 8.39, fallback: false });
    expect(buildQuote(basic, "AE", rates, auto).charge).toMatchObject({ currency: "AED", fallback: false });
    expect(buildQuote(basic, "GB", rates, auto).charge).toMatchObject({ currency: "GBP", fallback: false });
    expect(buildQuote(basic, "IN", rates, auto).charge).toMatchObject({ currency: "INR", total: 942.82 });
  });

  it("auto mode still never charges zero- or three-decimal currencies directly, and needs a rate", () => {
    const auto = new Set(["INR", "*"]);
    expect(buildQuote(basic, "JP", rates, auto).charge).toMatchObject({ currency: "INR", fallback: true });
    expect(buildQuote(basic, "KW", rates, auto).charge).toMatchObject({ currency: "INR", fallback: true });
    expect(buildQuote(basic, "GB", null, auto).charge).toMatchObject({ currency: "INR", fallback: true });
  });

  it("a currency Razorpay has just refused is skipped (INR offer) until the memory expires", () => {
    const auto = new Set(["INR", "*"]);
    markCurrencyRefused("USD");
    expect(isChargeable(auto, "USD")).toBe(false);
    expect(buildQuote(basic, "US", rates, auto).charge).toMatchObject({ currency: "INR", fallback: true });
    expect(buildQuote(basic, "AE", rates, auto).charge).toMatchObject({ currency: "AED" });     // other currencies unaffected
    jest.useFakeTimers().setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(isChargeable(auto, "USD")).toBe(true);
    jest.useRealTimers();
  });
});
