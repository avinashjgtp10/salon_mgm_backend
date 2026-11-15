// Support notifications go to the platform salon's feed, one per event, and the deadline sweep raises due-soon / overdue once.
const createOnce = jest.fn(async (d: any) => ({ id: "n1", ...d }));
jest.mock("../notifications/notifications.repository", () => ({ notificationsRepository: { createOnce: (d: any) => createOnce(d) } }));
let platform: string | null = "platform-salon";
jest.mock("../client-announcements/platform-salon", () => ({ getPlatformSalonId: async () => platform, ensurePlatformSalon: async () => "platform-salon" }));
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn() }, safeQuery: (fn: any) => fn() }));
const openCallbacks = jest.fn();
jest.mock("./support.repository", () => ({ supportRepo: { getOpenCallbacksWithTime: () => openCallbacks() } }));

import { notifySupport } from "./support.notifications";
import { runCallbackDeadlineSweep } from "./support.callbackScheduler";

const ticket = { id: "11111111-2222-3333-4444-555555555555", category: "Billing", subject: "Invoice missing", salon_name: "Glow" };
const callback = { id: "aaaaaaaa-2222-3333-4444-555555555555", category: "Callback", salon_name: "Glow", callback_phone: "+91 98765 43210" };

beforeEach(() => { jest.clearAllMocks(); platform = "platform-salon"; });

describe("notifySupport", () => {
    it("raises a new-ticket notification under the platform salon, keyed to the ticket", async () => {
        await notifySupport(ticket, { kind: "new" });
        expect(createOnce).toHaveBeenCalledWith(expect.objectContaining({
            salon_id: "platform-salon", type: "support_ticket", reference_id: ticket.id, title: "New ticket TKT-11111111",
        }));
    });

    it("words callback events with the callback number and word for the status", async () => {
        await notifySupport(callback, { kind: "new" });
        await notifySupport(callback, { kind: "status", status: "resolved" });
        await notifySupport(callback, { kind: "status", status: "closed" });
        const titles = createOnce.mock.calls.map((c) => c[0].title);
        expect(titles).toEqual(["New callback request CB-AAAAAAAA", "Callback CB-AAAAAAAA marked completed", "Callback CB-AAAAAAAA marked missed"]);
        expect(createOnce.mock.calls[0][0].type).toBe("support_callback");
    });

    it("has no due-soon or overdue notification for an ordinary ticket", async () => {
        await notifySupport(ticket, { kind: "overdue" });
        expect(createOnce).not.toHaveBeenCalled();
    });

    it("does nothing (and does not throw) when there is no platform salon yet", async () => {
        platform = null;
        await expect(notifySupport(ticket, { kind: "new" })).resolves.toBeUndefined();
        expect(createOnce).not.toHaveBeenCalled();
    });
});

describe("callback deadline sweep", () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    it("raises overdue for a passed time, due soon inside 10 minutes, and nothing for later ones", async () => {
        openCallbacks.mockResolvedValue([
            { ...callback, id: "00000000-0000-0000-0000-00000000000a", callback_at: "2026-11-06T09:30:00Z" },   // 30 min ago
            { ...callback, id: "00000000-0000-0000-0000-00000000000b", callback_at: "2026-11-06T10:05:00Z" },   // in 5 min
            { ...callback, id: "00000000-0000-0000-0000-00000000000c", callback_at: "2026-11-06T12:00:00Z" },   // in 2 h
        ]);
        await runCallbackDeadlineSweep(now);
        expect(createOnce.mock.calls.map((c) => c[0].title)).toEqual(["Callback CB-00000000 is overdue", "Callback CB-00000000 is due soon"]);
    });
});
