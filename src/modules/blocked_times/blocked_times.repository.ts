import pool from "../../config/database";
import type { BlockedTime, CreateBlockedTimeBody, UpdateBlockedTimeBody, BlockedTimeFilters } from "./blocked_times.types";

export const blockedTimesRepository = {

  async findById(id: string): Promise<BlockedTime | null> {
    const { rows } = await pool.query<BlockedTime>(
      `SELECT * FROM blocked_times WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async list(filters: BlockedTimeFilters): Promise<BlockedTime[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.salon_id) {
      conditions.push(`salon_id = $${idx}`);
      values.push(filters.salon_id); idx++;
    }
    if (filters.staff_id) {
      conditions.push(`staff_id = $${idx}`);
      values.push(filters.staff_id); idx++;
    }
    if (filters.date) {
      conditions.push(`date = $${idx}::date`);
      values.push(filters.date); idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query<BlockedTime>(
      `SELECT * FROM blocked_times ${where} ORDER BY date ASC, start_time ASC`,
      values
    );
    return rows;
  },

  /**
   * Returns true if [newStart, newEnd) overlaps any existing block for the same staff on the same date.
   * Used by the appointments service to reject bookings on blocked slots.
   */
  async hasOverlap(params: {
    staffId: string;
    date: string;
    startTime: string;
    endTime: string;
    excludeId?: string;
  }): Promise<BlockedTime | null> {
    const { staffId, date, startTime, endTime, excludeId } = params;
    const query = `
      SELECT * FROM blocked_times
      WHERE staff_id = $1
        AND date = $2::date
        AND start_time < $4::time
        AND end_time   > $3::time
        ${excludeId ? "AND id != $5" : ""}
      LIMIT 1
    `;
    const values: any[] = [staffId, date, startTime, endTime];
    if (excludeId) values.push(excludeId);
    const { rows } = await pool.query<BlockedTime>(query, values);
    return rows[0] || null;
  },

  async create(data: CreateBlockedTimeBody, createdBy: string): Promise<BlockedTime> {
    const { rows } = await pool.query<BlockedTime>(
      `INSERT INTO blocked_times (salon_id, staff_id, date, start_time, end_time, reason, created_by)
       VALUES ($1, $2, $3::date, $4::time, $5::time, $6, $7)
       RETURNING *`,
      [
        data.salon_id,
        data.staff_id,
        data.date,
        data.start_time,
        data.end_time,
        data.reason ?? null,
        createdBy,
      ]
    );
    return rows[0];
  },

  async update(id: string, patch: UpdateBlockedTimeBody): Promise<BlockedTime> {
    const TIME_FIELDS = new Set(["start_time", "end_time"]);
    const DATE_FIELDS = new Set(["date"]);

    const keys = Object.keys(patch) as (keyof UpdateBlockedTimeBody)[];
    if (keys.length === 0) {
      const { rows } = await pool.query<BlockedTime>(
        `SELECT * FROM blocked_times WHERE id = $1`,
        [id]
      );
      return rows[0];
    }

    const setParts: string[] = [];
    const values: any[] = [];

    keys.forEach((k) => {
      const i = values.length + 1;
      const val = (patch as any)[k];
      if (TIME_FIELDS.has(k as string)) {
        setParts.push(`${String(k)} = $${i}::time`);
      } else if (DATE_FIELDS.has(k as string)) {
        setParts.push(`${String(k)} = $${i}::date`);
      } else {
        setParts.push(`${String(k)} = $${i}`);
      }
      values.push(val);
    });

    setParts.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query<BlockedTime>(
      `UPDATE blocked_times SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteById(id: string): Promise<BlockedTime | null> {
    const { rows } = await pool.query<BlockedTime>(
      `DELETE FROM blocked_times WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0] || null;
  },
};
