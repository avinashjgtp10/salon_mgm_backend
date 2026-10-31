// Razorpay plan IDs are kept per Razorpay ACCOUNT. These tests prove TEST and LIVE can never read or overwrite each other's IDs, that the
// original subscription_plans.razorpay_plan_id column is never written, that an old ID is only adopted when the active account recognises
// it with the same amount/currency/period, and how Razorpay failures (refused currency, rate limit, network) are reported.

const poolQuery = jest.fn();
const fetchPlan = jest.fn();
const createPlan = jest.fn();
let schemaReady = true;

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: unknown[]) => poolQuery(...a) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }),
  getRazorpay: () => ({ plans: { fetch: (...a: unknown[]) => fetchPlan(...a) } }),
  createRazorpayPlan: (...a: unknown[]) => createPlan(...a),
  razorpayBilling: (c: string) => (c === "yearly" ? { period: "yearly", interval: 1 } : { period: "monthly", interval: c === "quarterly" ? 3 : 1 }),
}));
jest.mock("./billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(schemaReady) }));

import { resolveRazorpayPlan, fetchPlanOrNull } from "./razorpay-plans";
import { currentRazorpayAccount } from "./razorpay-account";
import type { BasePlan } from "./pricing.service";

const SECRET_KEY_ID = "rzp_test_SuperSecretKeyId123";
const base: BasePlan = { id: "plan-uuid", slug: "salonox-basic-yearly", tier: "basic", cycle: "yearly", name: "SalonOx Basic", price: 1800, razorpay_plan_id: "plan_legacy", razorpay_amount: 2124 };
const notFound = { statusCode: 400, error: { description: "The ID provided is invalid or could not be found." } };
const registryRows = (rows: unknown[]) => poolQuery.mockImplementation(async (sql: string) => (/FROM razorpay_plan_registry/.test(sql) ? { rows } : { rows: [] }));
const writesTo = (re: RegExp) => poolQuery.mock.calls.filter(([sql]) => re.test(String(sql)));
const plan = (over: Record<string, unknown> = {}) => ({ id: "plan_x", period: "yearly", interval: 1, item: { currency: "INR", amount: 212400 }, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  schemaReady = true;
  process.env.RAZORPAY_KEY_ID = SECRET_KEY_ID;
  createPlan.mockResolvedValue("plan_NEW");
  registryRows([]);
});

describe("account key", () => {
  it("tells TEST and LIVE apart and never contains the key id", () => {
    const test = currentRazorpayAccount({ RAZORPAY_KEY_ID: "rzp_test_abc" } as any);
    const live = currentRazorpayAccount({ RAZORPAY_KEY_ID: "rzp_live_abc" } as any);
    expect(test.mode).toBe("test");
    expect(live.mode).toBe("live");
    expect(test.key).not.toEqual(live.key);
    expect(test.key.startsWith("test:")).toBe(true);
    expect(live.key.startsWith("live:")).toBe(true);
    expect(currentRazorpayAccount({ RAZORPAY_KEY_ID: SECRET_KEY_ID } as any).key).not.toContain("SuperSecret");
  });
});

describe("registry lookups are scoped to the active account", () => {
  it("uses this account's registry row when Razorpay still knows it, and creates nothing", async () => {
    registryRows([{ razorpay_plan_id: "plan_REG" }]);
    fetchPlan.mockResolvedValue(plan({ id: "plan_REG" }));
    expect(await resolveRazorpayPlan(base, "INR", 2124, 1)).toBe("plan_REG");
    expect(createPlan).not.toHaveBeenCalled();
    const select = poolQuery.mock.calls.find(([sql]) => /FROM razorpay_plan_registry/.test(String(sql)))!;
    expect(select[1]).toContain(currentRazorpayAccount().key);   // the query is bound to this account's key
  });

  it("never writes subscription_plans (the original column) when it creates or adopts a plan", async () => {
    fetchPlan.mockRejectedValue(notFound);
    await resolveRazorpayPlan(base, "INR", 2124, 1);
    expect(writesTo(/UPDATE\s+subscription_plans/i)).toHaveLength(0);
    expect(writesTo(/INSERT INTO subscription_plans/i)).toHaveLength(0);
  });

  it("ignores an ID from another account (Razorpay does not know it), creates a new plan and registers it for this account only", async () => {
    fetchPlan.mockRejectedValue(notFound);                     // the legacy ID belongs to a different Razorpay account
    expect(await resolveRazorpayPlan(base, "INR", 2124, 1)).toBe("plan_NEW");
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ currency: "INR", amountRupees: 2124, period: "yearly", interval: 1 }));
    const insert = writesTo(/INSERT INTO razorpay_plan_registry/)[0];
    expect(insert[1]).toEqual(expect.arrayContaining([currentRazorpayAccount().key, "plan_NEW"]));
  });

  it("adopts the original ID only when this account recognises it with the same amount, currency and period", async () => {
    fetchPlan.mockResolvedValue(plan({ id: "plan_legacy" }));
    expect(await resolveRazorpayPlan(base, "INR", 2124, 1)).toBe("plan_legacy");
    expect(createPlan).not.toHaveBeenCalled();
    expect(writesTo(/INSERT INTO razorpay_plan_registry/)).toHaveLength(1);
  });

  it("does not adopt a recognised ID whose amount, period or currency differs (mismatched plan)", async () => {
    for (const bad of [
      plan({ item: { currency: "INR", amount: 99900 } }),      // other amount
      plan({ period: "monthly", interval: 1 }),                  // other period
      plan({ item: { currency: "USD", amount: 212400 } }),      // other currency
    ]) {
      createPlan.mockClear();
      fetchPlan.mockResolvedValue(bad);
      expect(await resolveRazorpayPlan(base, "INR", 2124, 1)).toBe("plan_NEW");
      expect(createPlan).toHaveBeenCalledTimes(1);
    }
  });

  it("a non-INR plan never adopts the original (INR) column", async () => {
    fetchPlan.mockResolvedValue(plan({ id: "plan_legacy" }));
    await resolveRazorpayPlan(base, "USD", 25, 0.0105);
    expect(fetchPlan).not.toHaveBeenCalledWith("plan_legacy");
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ currency: "USD", amountRupees: 25 }));
  });
});

describe("Razorpay failures", () => {
  it("a refused non-INR currency stops with CURRENCY_NOT_SUPPORTED and registers nothing", async () => {
    createPlan.mockRejectedValue(Object.assign(new Error("Razorpay could not create the plan: currency not supported"), { statusCode: 502 }));
    await expect(resolveRazorpayPlan(base, "USD", 25, 0.0105)).rejects.toMatchObject({ statusCode: 409, code: "CURRENCY_NOT_SUPPORTED" });
    expect(writesTo(/INSERT INTO razorpay_plan_registry/)).toHaveLength(0);
  });

  it("a rate limit (429) is a retryable error, never read as 'plan not found'", async () => {
    fetchPlan.mockRejectedValue({ statusCode: 429, error: { description: "Too many requests" } });
    await expect(fetchPlanOrNull("plan_x")).rejects.toMatchObject({ code: "RAZORPAY_RATE_LIMITED", statusCode: 503 });
    registryRows([{ razorpay_plan_id: "plan_REG" }]);
    await expect(resolveRazorpayPlan(base, "INR", 2124, 1)).rejects.toMatchObject({ code: "RAZORPAY_RATE_LIMITED" });
    expect(createPlan).not.toHaveBeenCalled();                 // a busy API must not create duplicate plans
  });

  it("a timeout or network failure is reported as unreachable, with nothing created", async () => {
    fetchPlan.mockRejectedValue(new Error("socket hang up"));
    await expect(fetchPlanOrNull("plan_x")).rejects.toMatchObject({ code: "RAZORPAY_UNREACHABLE", statusCode: 502 });
    registryRows([{ razorpay_plan_id: "plan_REG" }]);
    await expect(resolveRazorpayPlan(base, "INR", 2124, 1)).rejects.toMatchObject({ code: "RAZORPAY_UNREACHABLE" });
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("an INR plan creation error is passed through unchanged", async () => {
    fetchPlan.mockRejectedValue(notFound);
    createPlan.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 502, code: "RAZORPAY_ERROR" }));
    await expect(resolveRazorpayPlan(base, "INR", 2124, 1)).rejects.toMatchObject({ message: "boom" });
  });

  it("without the registry migration, INR keeps working through the original column (nothing written); a non-INR plan is refused (503)", async () => {
    schemaReady = false;
    expect(await resolveRazorpayPlan(base, "INR", 2124, 1)).toBe("plan_legacy");
    expect(createPlan).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
    await expect(resolveRazorpayPlan(base, "USD", 25, 0.0105)).rejects.toMatchObject({ statusCode: 503, code: "BILLING_SCHEMA_MISSING" });
    await expect(resolveRazorpayPlan({ ...base, razorpay_plan_id: null }, "INR", 2124, 1)).rejects.toMatchObject({ code: "BILLING_SCHEMA_MISSING" });
  });
});
