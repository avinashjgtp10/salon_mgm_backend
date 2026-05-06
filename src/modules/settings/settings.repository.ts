import pool from "../../config/database";
import { Setting, CreateSettingBody, UpdateSettingBody } from "./settings.types";

export const settingsRepository = {
  async findAll(salonId: string): Promise<Setting[]> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_settings WHERE salon_id = $1 ORDER BY key ASC`,
      [salonId],
    );
    return rows;
  },

  async findById(salonId: string, id: string): Promise<Setting | null> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_settings WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return rows[0] || null;
  },

  // Upsert by key — creates or replaces value for that key
  async upsert(salonId: string, body: CreateSettingBody): Promise<Setting> {
    const { rows } = await pool.query(
      `INSERT INTO salon_settings (salon_id, key, value, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (salon_id, key) DO UPDATE
         SET value       = EXCLUDED.value,
             description = COALESCE(EXCLUDED.description, salon_settings.description),
             updated_at  = NOW()
       RETURNING *`,
      [salonId, body.key, body.value, body.description ?? null],
    );
    return rows[0];
  },

  async update(salonId: string, id: string, body: UpdateSettingBody): Promise<Setting | null> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.key !== undefined)         { sets.push(`key = $${idx++}`);         values.push(body.key); }
    if (body.value !== undefined)       { sets.push(`value = $${idx++}`);       values.push(body.value); }
    if (body.description !== undefined) { sets.push(`description = $${idx++}`); values.push(body.description); }

    if (sets.length === 0) return this.findById(salonId, id);

    sets.push(`updated_at = NOW()`);
    values.push(id, salonId);

    const { rows } = await pool.query(
      `UPDATE salon_settings SET ${sets.join(", ")}
       WHERE id = $${idx} AND salon_id = $${idx + 1}
       RETURNING *`,
      values,
    );
    return rows[0] || null;
  },

  async delete(salonId: string, id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM salon_settings WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return (rowCount ?? 0) > 0;
  },
};
