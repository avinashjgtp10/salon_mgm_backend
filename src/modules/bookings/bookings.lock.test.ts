// Double bookings: the appointment must be written while the per-salon, per-day lock is still held, on the
// lock's own connection. If it is written after COMMIT, a second request can pass the overlap check first.

jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pool from "../../config/database";
import { bookingsRepository } from "./bookings.repository";

describe("booking lock", () => {
    it("writes the appointment on the lock's connection, before COMMIT", async () => {
        const log: string[] = [];
        const client = {
            query: jest.fn(async (sql: string) => {
                const text = String(sql).trim();
                log.push(text.startsWith("WITH n AS") ? "INSERT appointment" : text.includes("pg_advisory_xact_lock") ? "LOCK" : text);
                return { rows: [{ id: "appt-1" }] };
            }),
            release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValue(client);

        await bookingsRepository.withBookingLock("salon-1", "2026-12-01", async (dbClient) => {
            await bookingsRepository.createAppointment({
                salonId: "salon-1", clientId: "c", serviceId: "s", title: "Cut", scheduledAt: "2026-12-01T10:00:00+05:30",
                durationMinutes: 30, services: [],
            }, dbClient);
        });

        expect(log).toEqual(["BEGIN", "LOCK", "INSERT appointment", "COMMIT"]);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it("createBooking saves from inside the lock callback and nowhere else", () => {
        const source = readFileSync(join(__dirname, "bookings.service.ts"), "utf8");
        expect(source.match(/bookingsRepository\.createAppointment\(/g)).toHaveLength(1);
        expect(source).toMatch(/}, dbClient\);/);
        expect(source).toMatch(/const saved = await saveBooking\(/);
    });
});
