// Super Admin saving a plan price creates the Razorpay plan on the ACTIVE account and registers it for that account. The original
// subscription_plans.razorpay_plan_id / razorpay_amount columns (the LIVE mapping) are only ever updated by a LIVE server, never by TEST.

const registryInserts: unknown[][] = [];
const txQueries: { sql: string; params: unknown[] }[] = [];
const createPlan = jest.fn();
let existing: any[] = [];
let registryAmounts: { plan_id: string; amount: string }[] = [];
let schemaReady = true;

const poolQuery = jest.fn(async (sql: string, params?: unknown[]) => {
  const s = String(sql);
  if (/SELECT id, slug, price, is_active, razorpay_plan_id, razorpay_amount FROM subscription_plans/.test(s)) return { rows: existing };
  if (/SELECT plan_id, amount FROM razorpay_plan_registry/.test(s)) return { rows: registryAmounts };
  if (/SELECT DISTINCT ON \(plan_id\)/.test(s)) return { rows: [] };
  if (/SELECT id FROM subscription_plans WHERE slug/.test(s)) return { rows: [{ id: "plan-1" }] };
  if (/INSERT INTO razorpay_plan_registry/.test(s)) { registryInserts.push(params ?? []); return { rows: [] }; }
  if (/SELECT id, slug, price, is_active, razorpay_plan_id FROM subscription_plans/.test(s)) return { rows: existing };
  if (/FROM module_plans/.test(s)) return { rows: [] };
  return { rows: [] };
});
const client = {
  query: jest.fn(async (sql: string, params?: unknown[]) => { txQueries.push({ sql: String(sql), params: params ?? [] }); return { rows: [{ id: "plan-1" }], rowCount: 1 }; }),
  release: jest.fn(),
};

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: [string, unknown[]?]) => poolQuery(...a), connect: () => Promise.resolve(client) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../../config/razorpay", () => ({
  getRazorpayCredentials: async () => ({ keyId: process.env.RAZORPAY_KEY_ID ?? null, keySecret: null, webhookSecret: null }),
  createRazorpayPlan: (...a: unknown[]) => createPlan(...a),
  getRazorpay: jest.fn(),
  razorpayBilling: (c: string) => (c === "yearly" ? { period: "yearly", interval: 1 } : { period: "monthly", interval: c === "quarterly" ? 3 : 1 }),
}));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: () => Promise.resolve(schemaReady) }));

import { planPricingService } from "./plan-pricing.service";

const row = (over: Record<string, unknown> = {}) => ({ id: "plan-1", slug: "salonox-basic-monthly", price: "699", is_active: true, razorpay_plan_id: "plan_LIVE_LEGACY", razorpay_amount: "824.82", ...over });
const updateOf = () => txQueries.find((q) => /UPDATE subscription_plans\s+SET price/.test(q.sql))!;

beforeEach(() => {
  jest.clearAllMocks();
  registryInserts.length = 0;
  txQueries.length = 0;
  existing = [row()];
  registryAmounts = [];
  schemaReady = true;
  createPlan.mockResolvedValue("plan_NEW_ID");
});

describe("TEST keys never touch the LIVE plan columns", () => {
  beforeEach(() => { process.env.RAZORPAY_KEY_ID = "rzp_test_abc"; });

  it("creates a plan for the new price, registers it for the test account and keeps the original columns unchanged", async () => {
    await planPricingService.set("basic", { monthly: 799 });
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ amountRupees: 942.82, period: "monthly", interval: 1 }));
    const params = updateOf().params;
    expect(params[4]).toBe("plan_LIVE_LEGACY");     // razorpay_plan_id untouched
    expect(Number(params[5])).toBe(824.82);          // razorpay_amount untouched
    expect(params[1]).toBe(799);                     // the price itself is saved
    expect(registryInserts).toHaveLength(1);
    expect(registryInserts[0]).toEqual(expect.arrayContaining(["plan-1", expect.stringMatching(/^test:/), "test", "INR", 942.82, "plan_NEW_ID"]));
  });

  it("does not create a duplicate when this account already has a plan for that amount", async () => {
    registryAmounts = [{ plan_id: "plan-1", amount: "824.82" }];
    await planPricingService.set("basic", { monthly: 699 });
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("does not trust the original (LIVE) column to mean 'already done' on a test account", async () => {
    // the original column matches the price + GST, but it belongs to another account: this account has no registry row, so it creates its own
    await planPricingService.set("basic", { monthly: 699 });
    expect(createPlan).toHaveBeenCalledTimes(1);
  });
});

describe("LIVE keys keep the original columns in step (existing behaviour)", () => {
  beforeEach(() => { process.env.RAZORPAY_KEY_ID = "rzp_live_abc"; });

  it("updates the original columns and registers the plan for the live account", async () => {
    await planPricingService.set("basic", { monthly: 799 });
    const params = updateOf().params;
    expect(params[4]).toBe("plan_NEW_ID");
    expect(Number(params[5])).toBe(942.82);
    expect(registryInserts[0]).toEqual(expect.arrayContaining([expect.stringMatching(/^live:/), "live", "plan_NEW_ID"]));
  });

  it("an unchanged price whose original column already matches creates no new plan (existing LIVE plans are not duplicated)", async () => {
    await planPricingService.set("basic", { monthly: 699 });
    expect(createPlan).not.toHaveBeenCalled();
  });
});
