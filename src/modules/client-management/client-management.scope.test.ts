// A team member (any Super Admin login other than the owner) only sees and changes the records assigned to THEM; the owner sees all.
// avinash@salonox.com is the owner; nishant and rutuja are team members with their own developers rows.
import express from "express";
import request from "supertest";

const OWNER_ID = "owner-user";
const NISHANT_USER = "nishant-user";
const RUTUJA_USER = "rutuja-user";
const NISHANT_DEV = "11111111-1111-1111-1111-111111111111";
const RUTUJA_DEV = "22222222-2222-2222-2222-222222222222";
const SALON = "33333333-3333-3333-3333-333333333333";
const M_NISHANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const M_RUTUJA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), log: jest.fn() } }));
jest.mock("../super-admin/super-admin-owner.middleware", () => {
    const { AppError } = require("../../middleware/error.middleware");
    const isOwner = async (uid: string) => uid === "owner-user";
    return {
        isSuperAdminOwner: isOwner,
        superAdminOwnerOnly: async (req: any, _res: any, next: any) => (await isOwner(req.user?.userId) ? next() : next(new AppError(403, "Only the Super Admin owner can open this.", "FORBIDDEN"))),
    };
});
jest.mock("../super-admin/super-admin-activity", () => ({ ownerActivity: { feed: jest.fn() } }));
jest.mock("./developer-logins", () => ({ developerLogins: { list: jest.fn(async () => []) }, updateDeveloper: jest.fn() }));

const meetings: Record<string, any> = {
    [M_NISHANT]: { id: M_NISHANT, developer_id: NISHANT_DEV, salon_id: SALON, title: "Nishant's meeting", status: "scheduled" },
    [M_RUTUJA]: { id: M_RUTUJA, developer_id: RUTUJA_DEV, salon_id: SALON, title: "Rutuja's meeting", status: "scheduled" },
};
const repo: any = {
    developerIdForUser: jest.fn(async (u: string) => ({ [NISHANT_USER]: NISHANT_DEV, [RUTUJA_USER]: RUTUJA_DEV } as any)[u] ?? null),
    listMeetings: jest.fn(async (f: any) => {
        const items = Object.values(meetings).filter((m: any) => !f.developerId?.length || f.developerId.includes(m.developer_id));
        return { items, total: items.length };
    }),
    getMeeting: jest.fn(async (id: string) => meetings[id] ?? null),
    entityDeveloper: jest.fn(async (_t: string, id: string) => ({ exists: !!meetings[id], developerId: meetings[id]?.developer_id ?? null })),
    updateMeeting: jest.fn(async () => ({ id: "x" })),
    createMeeting: jest.fn(async () => M_NISHANT),
    salonExists: jest.fn(async () => true),
    developerExists: jest.fn(async () => true),
    dashboard: jest.fn(async () => ({})),
    reports: jest.fn(async () => ({ items: [], total: 0 })),
};
jest.mock("./client-management.repository", () => ({
    clientManagementRepository: new Proxy({}, { get: (_t, k) => repo[k as string] }),
    MEETING_TYPES: ["client_meeting"], MEETING_MODES: ["online"], MEETING_STATUSES: ["scheduled", "completed", "cancelled", "rescheduled", "not_conducted"],
    TRAINING_STATUSES: ["not_started"], UNDERSTANDING: [], ACTIVITY_TYPES: ["general"], TASK_STATUSES: ["pending"], TASK_PRIORITIES: ["medium"], ATTACHMENT_ENTITIES: ["meeting", "task", "activity", "training"],
}));

import router from "./client-management.routes";
import { errorHandler } from "../../middleware/error.middleware";

const appAs = (userId: string) => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { userId, role: "super_admin" }; next(); });
    app.use("/", router);
    app.use(errorHandler as any);
    return app;
};

beforeEach(() => jest.clearAllMocks());

describe("Client Management is scoped per team member", () => {
    it("the owner sees every meeting", async () => {
        const res = await request(appAs(OWNER_ID)).get("/meetings");
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(2);
    });

    it("nishant sees only his own meeting, even if he asks for someone else's", async () => {
        const res = await request(appAs(NISHANT_USER)).get(`/meetings?developer_id=${RUTUJA_DEV}`);
        expect(res.status).toBe(200);
        expect(res.body.data.items.map((m: any) => m.title)).toEqual(["Nishant's meeting"]);
        expect(repo.listMeetings.mock.calls[0][0].developerId).toEqual([NISHANT_DEV]);
    });

    it("another developer's meeting reads as not found (open, edit, complete)", async () => {
        const app = appAs(NISHANT_USER);
        expect((await request(app).get(`/meetings/${M_RUTUJA}`)).status).toBe(404);
        expect((await request(app).patch(`/meetings/${M_RUTUJA}`).send({ title: "hijack" })).status).toBe(404);
        expect((await request(app).post(`/meetings/${M_RUTUJA}/complete`).send({})).status).toBe(404);
        expect(repo.updateMeeting).not.toHaveBeenCalled();
        // ...while his own opens fine
        expect((await request(app).get(`/meetings/${M_NISHANT}`)).status).toBe(200);
    });

    it("a meeting a team member schedules is always assigned to them, whatever they send", async () => {
        const res = await request(appAs(NISHANT_USER)).post("/meetings").send({
            salon_id: SALON, developer_id: RUTUJA_DEV, meeting_type: "client_meeting", meeting_date: "2026-12-01", meeting_mode: "online",
        });
        expect(res.status).toBe(201);
        expect(repo.createMeeting.mock.calls[0][0].developer_id).toBe(NISHANT_DEV);
    });

    it("a team member cannot hand their meeting to someone else", async () => {
        await request(appAs(NISHANT_USER)).patch(`/meetings/${M_NISHANT}`).send({ developer_id: RUTUJA_DEV, purpose: "x" });
        expect(repo.updateMeeting.mock.calls[0][1].developer_id).toBe(NISHANT_DEV);
    });

    it("a login with no team-member entry sees nothing", async () => {
        const res = await request(appAs("stranger-user")).get("/meetings");
        expect(res.body.data.total).toBe(0);
    });

    it("the dashboard and reports are limited to the team member too; the owner is not", async () => {
        await request(appAs(NISHANT_USER)).get("/dashboard");
        await request(appAs(NISHANT_USER)).get("/reports");
        await request(appAs(OWNER_ID)).get("/dashboard");
        expect(repo.dashboard.mock.calls[0][0]).toBe(NISHANT_DEV);
        expect(repo.reports.mock.calls[0][0].developerId).toBe(NISHANT_DEV);
        expect(repo.dashboard.mock.calls[1][0]).toBeNull();
    });

    it("developer logins and the owner's activity feed stay owner-only", async () => {
        expect((await request(appAs(NISHANT_USER)).get("/developer-logins")).status).toBe(403);
        expect((await request(appAs(NISHANT_USER)).get("/developer-activity")).status).toBe(403);
        expect((await request(appAs(OWNER_ID)).get("/developer-logins")).status).toBe(200);
    });
});
