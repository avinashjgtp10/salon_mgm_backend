jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { calendarDaysLeft } from "./salon-subscription.service";

// 31 Oct 2026, 10:10 in India = 04:40 UTC.
const NOW = Date.UTC(2026, 9, 31, 4, 40, 0);

describe("calendarDaysLeft", () => {
    it("counts calendar days from today's date in India (31 Oct -> 1 Dec = 31, extend one day = 32)", () => {
        expect(calendarDaysLeft("2026-12-01 00:00:00", NOW)).toBe(31);
        expect(calendarDaysLeft("2026-12-02 23:59:59", NOW)).toBe(32);
    });
    it("gives the same answer whether the end was stored as midnight or 23:59:59", () => {
        expect(calendarDaysLeft("2026-12-01 00:00:00", NOW)).toBe(calendarDaysLeft("2026-12-01 23:59:59", NOW));
    });
    it("uses the date in India: at 00:30 IST on 1 Nov (UTC is still 31 Oct) the end of 1 Nov is 0 days away", () => {
        const justAfterMidnightIst = Date.UTC(2026, 9, 31, 19, 0, 0);
        expect(calendarDaysLeft("2026-11-01 23:59:59", justAfterMidnightIst)).toBe(0);
    });
    it("is 0 on the end day and negative after it", () => {
        expect(calendarDaysLeft("2026-10-31 23:59:59", NOW)).toBe(0);
        expect(calendarDaysLeft("2026-10-30 23:59:59", NOW)).toBe(-1);
    });
});
