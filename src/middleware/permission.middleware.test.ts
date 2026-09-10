// Regression coverage for the Sales permission-key mismatch: the frontend's
// permission catalog (permissionMatrix.ts) used to define
// view_quick_sale/create_quick_sale, while sales.routes.ts has only ever
// checked view_sales/create_sales/import_sales. Because the per-staff
// override blob is a flat { permKey: boolean } map, the moment ANY override
// existed for a staff member — even one totally unrelated to Sales — the
// blob was built from the (wrong) frontend keys, so a lookup for the
// backend's real keys (`customPerms["create_sales"]`) always missed and
// silently resolved to `false`. Both sides now agree on view_sales/
// create_sales/import_sales (see permissionMatrix.ts and DEFAULT_STAFF_PERMS
// below) — this file proves an unrelated override can no longer take Sales
// access down with it, and pins the bug's mechanics so a future rename on
// either side gets caught here instead of in production.

jest.mock("../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import pool from "../config/database";
import { staffHasPermission, type PermUser } from "./permission.middleware";

const mockQuery = pool.query as jest.Mock;

function mockRows(sqlMatcher: (sql: string) => any[] | null) {
  mockQuery.mockImplementation(async (sql: string) => ({ rows: sqlMatcher(sql) ?? [] }));
}

describe("staffHasPermission — Sales permission-key regression", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("new path (role_id assigned): an unrelated staff_permission_overrides row does not remove create_sales/view_sales access", async () => {
    const user: PermUser = { userId: "user-1", role: "staff", salonId: "salon-1" };

    mockRows((sql) => {
      if (sql.includes("role_id FROM staff")) return [{ id: "staff-1", role_id: "role-1" }];
      // Only an unrelated permission was ever overridden for this staff
      // member — no row for create_sales/view_sales at all.
      if (sql.includes("FROM staff_permission_overrides")) return [{ permission_key: "edit_clients", allowed: true }];
      if (sql.includes("FROM role_permissions")) return [
        { permission_key: "create_sales", allowed: true },
        { permission_key: "view_sales", allowed: true },
      ];
      return null;
    });

    await expect(staffHasPermission(user, "create_sales")).resolves.toBe(true);
    await expect(staffHasPermission(user, "view_sales")).resolves.toBe(true);
  });

  it("legacy path (custom_permissions blob): a blob built under the canonical key names preserves Sales access alongside an unrelated override", async () => {
    const user: PermUser = { userId: "user-2", role: "staff", salonId: "salon-1" };

    mockRows((sql) => {
      if (sql.includes("role_id FROM staff")) return [{ id: "staff-2", role_id: null }];
      if (sql.includes("custom_permissions FROM staff")) return [{
        custom_permissions: {
          edit_clients: true,   // the one permission actually toggled by the owner
          view_sales: true,     // seeded correctly because permissionMatrix.ts now
          create_sales: true,   // uses the same key names the backend checks
        },
      }];
      return null;
    });

    await expect(staffHasPermission(user, "create_sales")).resolves.toBe(true);
    await expect(staffHasPermission(user, "view_sales")).resolves.toBe(true);
  });

  it("pins the original bug: a blob keyed under the old view_quick_sale/create_quick_sale names does NOT satisfy view_sales/create_sales", async () => {
    const user: PermUser = { userId: "user-3", role: "staff", salonId: "salon-1" };

    mockRows((sql) => {
      if (sql.includes("role_id FROM staff")) return [{ id: "staff-3", role_id: null }];
      if (sql.includes("custom_permissions FROM staff")) return [{
        custom_permissions: {
          edit_clients: true,
          view_quick_sale: true,   // the old, no-longer-defined frontend key
          create_quick_sale: true, // the old, no-longer-defined frontend key
        },
      }];
      return null;
    });

    // This is exactly the silent-loss failure mode the ticket describes —
    // demonstrating why the two sides had to be reconciled onto one key set.
    await expect(staffHasPermission(user, "create_sales")).resolves.toBe(false);
    await expect(staffHasPermission(user, "view_sales")).resolves.toBe(false);
  });

  it("legacy fallback (nothing configured for this salon at all): DEFAULT_STAFF_PERMS grants the canonical Sales keys, not the old ones", async () => {
    const user: PermUser = { userId: "user-4", role: "staff", salonId: "salon-2" };

    mockRows((sql) => {
      if (sql.includes("role_id FROM staff")) return [{ id: "staff-4", role_id: null }];
      if (sql.includes("custom_permissions FROM staff")) return [{ custom_permissions: null }];
      if (sql.includes("FROM salon_settings")) return []; // no role_permissions row saved yet
      return null;
    });

    await expect(staffHasPermission(user, "view_sales")).resolves.toBe(true);
    await expect(staffHasPermission(user, "create_sales")).resolves.toBe(true);
    // import_sales is deliberately off by default (bulk billing import is
    // higher-risk than an ordinary sale) — must be explicitly granted.
    await expect(staffHasPermission(user, "import_sales")).resolves.toBe(false);
    // The old key names were never part of DEFAULT_STAFF_PERMS to begin with.
    await expect(staffHasPermission(user, "create_quick_sale")).resolves.toBe(false);
  });
});
