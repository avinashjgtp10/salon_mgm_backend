import pool from "../../config/database";
import { Setting, CreateSettingBody, UpdateSettingBody } from "./settings.types";

// findAll() is hit repeatedly within a single request by unrelated callers
// that each independently need the settings blob (getActiveTaxes calls it
// twice on its own — see tax.util.ts — and rewardPointsRepository.getConfig/
// referralRepository.getConfig each call it again), so a single
// calculate-totals request could issue up to 6 identical
// `SELECT * FROM salon_settings WHERE salon_id=$1` round trips. Settings
// change rarely, so a short TTL cache here fixes every one of those call
// sites transparently with no signature changes. Invalidated on every write
// through this repository (upsert/update/delete); the TTL alone is the
// staleness bound for writes made by other repositories that touch this same
// table directly (e.g. super-admin's role/subscription permission writes —
// confirmed those are read via their own separate, already-cached direct
// queries, not through findAll(), so this cache never masks their writes).
const SETTINGS_CACHE_TTL_MS = 10_000;
const settingsCache = new Map<string, { data: Setting[]; expiresAt: number }>();

function invalidateSettingsCache(salonId: string): void {
  settingsCache.delete(salonId);
}

export const settingsRepository = {
  async findAll(salonId: string): Promise<Setting[]> {
    const cached = settingsCache.get(salonId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const { rows } = await pool.query(
      `SELECT * FROM salon_settings WHERE salon_id = $1 ORDER BY key ASC`,
      [salonId],
    );
    settingsCache.set(salonId, { data: rows, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
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
    invalidateSettingsCache(salonId);
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
    invalidateSettingsCache(salonId);
    return rows[0] || null;
  },

  async delete(salonId: string, id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM salon_settings WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    invalidateSettingsCache(salonId);
    return (rowCount ?? 0) > 0;
  },
};
