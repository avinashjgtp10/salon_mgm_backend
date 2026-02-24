// src/modules/branches/branches.repository.ts

import pool from "../../config/database";
import { Branch, BranchHoliday, BranchTiming, CreateBranchBody, TimingDayInput, UpdateBranchBody } from "./branches.types";

export const branchesRepository = {
    // ---------- BRANCH ----------
    async findById(id: string): Promise<Branch | null> {
        const { rows } = await pool.query(`SELECT * FROM branches WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async listBySalonId(salonId: string): Promise<Branch[]> {
        const { rows } = await pool.query(
            `SELECT * FROM branches WHERE salon_id = $1 ORDER BY is_main DESC, created_at DESC`,
            [salonId]
        );
        return rows;
    },

    async unsetMainBranch(salonId: string): Promise<void> {
        await pool.query(
            `UPDATE branches SET is_main = FALSE, updated_at = NOW() WHERE salon_id = $1 AND is_main = TRUE`,
            [salonId]
        );
    },

    async create(salonId: string, data: CreateBranchBody): Promise<Branch> {
        const { rows } = await pool.query(
            `INSERT INTO branches (
        salon_id, name,
        address_line1, address_line2, city, state, pincode, country,
        latitude, longitude, phone, email,
        is_main, opening_time, closing_time,
        is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
            [
                salonId,
                data.name.trim(),
                data.address_line1.trim(),
                data.address_line2 ?? null,
                data.city.trim(),
                data.state.trim(),
                data.pincode.trim(),
                (data.country ?? "India").trim(),
                data.latitude ?? null,
                data.longitude ?? null,
                data.phone ?? null,
                data.email ?? null,
                data.is_main ?? false,
                data.opening_time ?? null,
                data.closing_time ?? null,
                data.is_active ?? true,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateBranchBody): Promise<Branch> {
        const keys = Object.keys(patch) as (keyof UpdateBranchBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM branches WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k, idx) => {
            setParts.push(`${k} = $${idx + 1}`);
            values.push((patch as any)[k]);
        });

        setParts.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await pool.query(
            `UPDATE branches SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
            values
        );

        return rows[0];
    },

    // ---------- TIMINGS ----------
    async listTimings(branchId: string): Promise<BranchTiming[]> {
        const { rows } = await pool.query(
            `SELECT * FROM branch_timings WHERE branch_id = $1 ORDER BY day_of_week ASC`,
            [branchId]
        );
        return rows;
    },

    async upsertTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const out: BranchTiming[] = [];

            for (const d of days) {
                const isClosed = d.is_closed === true;
                const opening = isClosed ? "00:00:00" : (d.opening_time ?? "00:00:00");
                const closing = isClosed ? "00:00:00" : (d.closing_time ?? "00:00:00");

                const { rows } = await client.query(
                    `INSERT INTO branch_timings (branch_id, day_of_week, opening_time, closing_time, is_closed)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (branch_id, day_of_week)
           DO UPDATE SET
             opening_time = EXCLUDED.opening_time,
             closing_time = EXCLUDED.closing_time,
             is_closed = EXCLUDED.is_closed
           RETURNING *`,
                    [branchId, d.day_of_week, opening, closing, isClosed]
                );

                out.push(rows[0]);
            }

            await client.query("COMMIT");
            return out.sort((a, b) => a.day_of_week - b.day_of_week);
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    async replaceTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            await client.query(`DELETE FROM branch_timings WHERE branch_id = $1`, [branchId]);

            const out: BranchTiming[] = [];
            for (const d of days) {
                const isClosed = d.is_closed === true;
                const opening = isClosed ? "00:00:00" : (d.opening_time ?? "00:00:00");
                const closing = isClosed ? "00:00:00" : (d.closing_time ?? "00:00:00");

                const { rows } = await client.query(
                    `INSERT INTO branch_timings (branch_id, day_of_week, opening_time, closing_time, is_closed)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
                    [branchId, d.day_of_week, opening, closing, isClosed]
                );
                out.push(rows[0]);
            }

            await client.query("COMMIT");
            return out.sort((a, b) => a.day_of_week - b.day_of_week);
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    },

    // ---------- HOLIDAYS ----------
    async createHoliday(branchId: string, holidayDate: string, reason?: string): Promise<BranchHoliday> {
        const { rows } = await pool.query(
            `INSERT INTO branch_holidays (branch_id, holiday_date, reason)
       VALUES ($1,$2,$3)
       RETURNING *`,
            [branchId, holidayDate, reason ?? null]
        );
        return rows[0];
    },

    async listHolidays(branchId: string, from?: string, to?: string): Promise<BranchHoliday[]> {
        const values: any[] = [branchId];
        const where: string[] = [`branch_id = $1`];

        if (from) {
            values.push(from);
            where.push(`holiday_date >= $${values.length}`);
        }
        if (to) {
            values.push(to);
            where.push(`holiday_date <= $${values.length}`);
        }

        const { rows } = await pool.query(
            `SELECT * FROM branch_holidays WHERE ${where.join(" AND ")} ORDER BY holiday_date ASC`,
            values
        );

        return rows;
    },

    async findHolidayById(id: string): Promise<BranchHoliday | null> {
        const { rows } = await pool.query(`SELECT * FROM branch_holidays WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async deleteHolidayById(id: string): Promise<void> {
        await pool.query(`DELETE FROM branch_holidays WHERE id = $1`, [id]);
    },
};
