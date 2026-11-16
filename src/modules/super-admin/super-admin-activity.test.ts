// The Super Admin activity logger: records successful account / salon changes, never secrets, never failed requests, never reads.
const query = jest.fn();
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: any[]) => query(...a) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));

import { EventEmitter } from "events";
import { superAdminActivityLogger } from "./super-admin-activity";

function run(method: string, url: string, body: any, status = 200) {
    const res: any = new EventEmitter();
    res.statusCode = status;
    const req: any = { method, originalUrl: url, body, user: { userId: "owner-1" } };
    const next = jest.fn();
    superAdminActivityLogger(req, res, next);
    res.emit("finish");
    return next;
}
const flush = () => new Promise((r) => setTimeout(r, 20));
const inserts = () => query.mock.calls.filter((c) => /INSERT INTO super_admin_activity_log/.test(String(c[0])));

beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql: string) => {
        if (/SELECT email FROM users WHERE id = \$1/.test(sql)) return { rows: [{ email: "avinash@salonox.com" }] };
        if (/SELECT email FROM users WHERE id::text/.test(sql)) return { rows: [{ email: "target@x.com" }] };
        return { rows: [] };
    });
});

describe("superAdminActivityLogger", () => {
    it("records an account being created, labelled with the new account's email, without the password", async () => {
        const next = run("POST", "/api/v1/super-admin/users/create", { email: "new@x.com", role: "salon_owner", password: "Secret#123" });
        expect(next).toHaveBeenCalled();
        await flush();
        const [, args] = inserts()[0];
        expect(args).toEqual(["owner-1", "avinash@salonox.com", "account_created", "user", null, "new@x.com", { role: "salon_owner" }]);
        expect(JSON.stringify(args)).not.toContain("Secret");
    });

    it("records a role change with the target's email", async () => {
        run("PATCH", "/api/v1/super-admin/users/u-9/role?x=1", { role: "admin" });
        await flush();
        expect(inserts()[0][1]).toEqual(["owner-1", "avinash@salonox.com", "account_role_changed", "user", "u-9", "target@x.com", { role: "admin" }]);
    });

    it("records impersonation and a password reset, never the new password", async () => {
        run("POST", "/api/v1/super-admin/users/u-9/impersonate", {});
        run("POST", "/api/v1/super-admin/users/u-9/reset-password", { password: "Hunter2!" });
        await flush();
        const actions = inserts().map((c) => c[1][2]);
        expect(actions).toEqual(expect.arrayContaining(["account_impersonated", "password_reset"]));
        expect(JSON.stringify(inserts())).not.toContain("Hunter2");
    });

    it("ignores reads, failed requests, and deletes (those have their own log)", async () => {
        run("GET", "/api/v1/super-admin/users", undefined);
        run("PATCH", "/api/v1/super-admin/users/u-9/role", { role: "admin" }, 403);
        run("DELETE", "/api/v1/super-admin/users/u-9", undefined);
        run("DELETE", "/api/v1/super-admin/salons/s-1", undefined);
        await flush();
        expect(inserts()).toHaveLength(0);
    });

    it("never breaks the request when logging itself fails", async () => {
        query.mockRejectedValue(new Error("db down"));
        const next = run("POST", "/api/v1/super-admin/users/create", { email: "a@b.c" });
        expect(next).toHaveBeenCalled();
        await expect(flush()).resolves.toBeUndefined();
    });
});
