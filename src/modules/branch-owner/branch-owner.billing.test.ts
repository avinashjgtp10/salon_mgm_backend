// GET /branch-owner/salons/billing: every assigned salon's subscription, plan and invoices in one response; a salon that fails
// is returned empty and marked failed without hurting the others.

const getMySalons = jest.fn();
jest.mock("./branch-owner.repository", () => ({ branchOwnerRepository: { getMySalons: (...a: unknown[]) => getMySalons(...a) } }));

const getSubscription = jest.fn();
const getPlanById = jest.fn();
const listInvoices = jest.fn();
jest.mock("../billing/billing.service", () => ({
  billingService: {
    getSubscription: (...a: unknown[]) => getSubscription(...a),
    getPlanById: (...a: unknown[]) => getPlanById(...a),
    listInvoices: (...a: unknown[]) => listInvoices(...a),
  },
}));

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock("../super-admin/super-admin.repository", () => ({ superAdminRepository: {} }));
jest.mock("../salon-dashboard/salon-dashboard.repository", () => ({ salonDashboardRepository: {} }));
jest.mock("../salon-dashboard/salon-revenue", () => ({ getRevenueFiguresBySalon: jest.fn() }));
jest.mock("../staff/staff.service", () => ({ staffCommissionsService: {}, staffService: {} }));
jest.mock("../roles/roles.service", () => ({ rolesService: {} }));
jest.mock("../support/support.service", () => ({ supportService: {} }));
jest.mock("../notifications/notifications.service", () => ({ notificationsService: {} }));

import { branchOwnerService } from "./branch-owner.service";

describe("branchOwnerService.getSalonsBilling", () => {
  beforeEach(() => { jest.resetAllMocks(); });

  it("returns each assigned salon's subscription, plan and invoices keyed by salon id", async () => {
    getMySalons.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    getSubscription.mockImplementation(async (id: string) => (id === "s1" ? { id: "sub1", plan_id: "p1" } : null));
    getPlanById.mockResolvedValue({ id: "p1", name: "Pro" });
    listInvoices.mockImplementation(async ({ salon_id }: any) => ({ data: [{ id: `inv-${salon_id}` }] }));

    const out: any = await branchOwnerService.getSalonsBilling("bo1");

    expect(getMySalons).toHaveBeenCalledWith("bo1");
    expect(out.s1).toEqual({ subscription: { id: "sub1", plan_id: "p1" }, plan: { id: "p1", name: "Pro" }, invoices: [{ id: "inv-s1" }], failed: false });
    expect(out.s2).toEqual({ subscription: null, plan: null, invoices: [{ id: "inv-s2" }], failed: false });
    expect(getPlanById).toHaveBeenCalledTimes(1); // no plan lookup for a salon without a subscription
    expect(listInvoices).toHaveBeenCalledWith({ salon_id: "s1", limit: 50 });
  });

  it("a failing salon is returned empty and marked failed, the others are unaffected", async () => {
    getMySalons.mockResolvedValue([{ id: "ok" }, { id: "bad" }]);
    getSubscription.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("db down");
      return { id: "sub", plan_id: "p" };
    });
    getPlanById.mockResolvedValue({ id: "p" });
    listInvoices.mockResolvedValue({ data: [] });

    const out: any = await branchOwnerService.getSalonsBilling("bo1");

    expect(out.ok.failed).toBe(false);
    expect(out.bad).toEqual({ subscription: null, plan: null, invoices: [], failed: true });
  });

  it("a plan that cannot be loaded does not fail the salon", async () => {
    getMySalons.mockResolvedValue([{ id: "s1" }]);
    getSubscription.mockResolvedValue({ id: "sub", plan_id: "gone" });
    getPlanById.mockRejectedValue(new Error("not found"));
    listInvoices.mockResolvedValue({ data: [] });

    const out: any = await branchOwnerService.getSalonsBilling("bo1");

    expect(out.s1).toEqual({ subscription: { id: "sub", plan_id: "gone" }, plan: null, invoices: [], failed: false });
  });

  it("a branch owner with no salons gets an empty object", async () => {
    getMySalons.mockResolvedValue([]);
    expect(await branchOwnerService.getSalonsBilling("bo1")).toEqual({});
  });
});
