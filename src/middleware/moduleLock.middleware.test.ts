// Salon Customization: per-salon module locks. Proves the rules the feature
// depends on: nothing locked by default, a lock blocks the salon (owner
// included), super admins bypass, locking a parent locks its children, the
// 60s cache is dropped on invalidate, and a missing table (migration not run
// yet) fails open instead of breaking every gated route.

jest.mock("../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("../config/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import pool from "../config/database";
import {
  requireModule,
  loadLockedModules,
  isModuleLocked,
  assertModuleUnlocked,
  invalidateModuleLockCache,
} from "./moduleLock.middleware";
import { expandLockedKeys, MODULE_LOCKED_MESSAGE } from "../modules/salon-modules/module-keys";

const mockQuery = pool.query as jest.Mock;

function lockedRows(...keys: string[]) {
  mockQuery.mockResolvedValue({ rows: keys.map((module_key) => ({ module_key })) });
}

function run(mw: ReturnType<typeof requireModule>, user: any) {
  return new Promise<any>((resolve) => {
    mw({ user } as any, {} as any, (err?: any) => resolve(err ?? null));
  });
}

describe("module lock middleware", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Each test uses its own salon id, but clear anyway so nothing leaks.
    ["s1", "s2", "s3", "s4", "s5", "s6"].forEach(invalidateModuleLockCache);
  });

  it("allows everything when the salon has no lock rows", async () => {
    lockedRows();
    expect(await run(requireModule("packages"), { userId: "u", role: "salon_owner", salonId: "s1" })).toBeNull();
  });

  it("blocks a locked module for the owner with 403 MODULE_LOCKED and the upgrade message", async () => {
    lockedRows("packages");
    const err = await run(requireModule("packages"), { userId: "u", role: "salon_owner", salonId: "s2" });
    expect(err).toMatchObject({ statusCode: 403, code: "MODULE_LOCKED", message: MODULE_LOCKED_MESSAGE });
  });

  it("only blocks the locked module, not its siblings", async () => {
    lockedRows("packages");
    expect(await run(requireModule("memberships"), { userId: "u", role: "staff", salonId: "s2" })).toBeNull();
  });

  it("lets a super admin through without touching the database", async () => {
    expect(await run(requireModule("packages"), { userId: "u", role: "super_admin" })).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("locking a parent locks its children (catalog -> packages, staff -> payroll)", async () => {
    lockedRows("catalog", "staff");
    const keys = await loadLockedModules("s3");
    for (const k of ["catalog", "services", "products", "packages", "memberships", "staff", "payroll"]) {
      expect(keys.has(k)).toBe(true);
    }
    expect(keys.has("inventory")).toBe(false);
    expect([...expandLockedKeys(["catalog"])].sort()).toEqual(["catalog", "memberships", "packages", "products", "services"]);
  });

  it("caches per salon and re-reads after invalidateModuleLockCache", async () => {
    lockedRows("packages");
    await isModuleLocked("s4", "packages");
    await isModuleLocked("s4", "packages");
    expect(mockQuery).toHaveBeenCalledTimes(1);

    lockedRows(); // super admin unlocked it
    invalidateModuleLockCache("s4");
    expect(await isModuleLocked("s4", "packages")).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("fails open when the salon_module_locks table doesn't exist yet", async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(await run(requireModule("packages"), { userId: "u", role: "salon_owner", salonId: "s5" })).toBeNull();
  });

  it("still surfaces unexpected database errors", async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error("connection lost"), { code: "08006" }));
    const err = await run(requireModule("packages"), { userId: "u", role: "salon_owner", salonId: "s6" });
    expect(err).toMatchObject({ message: "connection lost" });
  });

  it("assertModuleUnlocked throws for a locked module and ignores a missing salon id", async () => {
    lockedRows("memberships");
    await expect(assertModuleUnlocked("s2", "memberships")).rejects.toMatchObject({ code: "MODULE_LOCKED" });
    await expect(assertModuleUnlocked(null, "memberships")).resolves.toBeUndefined();
  });
});
