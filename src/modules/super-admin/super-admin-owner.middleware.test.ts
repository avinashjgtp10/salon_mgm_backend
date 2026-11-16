// Client Activity Management / Client Activity are for the Super Admin owner account only; every other Super Admin login gets 403.
const query = jest.fn();
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: any[]) => query(...a) } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));

import { superAdminOwnerOnly } from "./super-admin-owner.middleware";

const run = async (userId?: string) => {
    const next = jest.fn();
    await superAdminOwnerOnly({ user: userId ? { userId } : undefined } as any, {} as any, next);
    return next.mock.calls[0]?.[0];
};

describe("superAdminOwnerOnly", () => {
    beforeEach(() => query.mockReset());

    it("lets avinash@salonox.com through (any letter case)", async () => {
        query.mockResolvedValue({ rows: [{ email: "avinash@salonox.com" }] });
        expect(await run("u-owner")).toBeUndefined();
    });

    it("refuses another Super Admin login (a developer) with 403", async () => {
        query.mockResolvedValue({ rows: [{ email: "nishant@salonox.com" }] });
        expect(await run("u-dev")).toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    });

    it("refuses when nobody is signed in or the account is unknown", async () => {
        expect(await run(undefined)).toMatchObject({ statusCode: 403 });
        query.mockResolvedValue({ rows: [] });
        expect(await run("u-ghost")).toMatchObject({ statusCode: 403 });
    });
});
