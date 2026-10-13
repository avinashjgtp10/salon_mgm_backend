import type { Pool, PoolClient } from "pg";
import pool from "../../config/database";
import type {
  Asset, AssetEvent, AssetEventType, AssetIncident, AssetListFilters, AssetCondition, AssetStatus,
  IncidentType, InvestigationStatus,
} from "./assets.types";

type Db = Pool | PoolClient;

const STAFF_NAME = (alias: string) =>
  `NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), '')`;

const ASSET_SELECT = `
  a.*, b.name AS branch_name, ${STAFF_NAME("s")} AS current_staff_name
  FROM assets a
  LEFT JOIN branches b ON b.id = a.branch_id
  LEFT JOIN staff s ON s.id = a.current_staff_id`;

export const assetsRepository = {
  // ── lookups used to validate input belongs to the caller's salon ──────────
  async branchBelongsToSalon(branchId: string, salonId: string, db: Db = pool): Promise<boolean> {
    const { rows } = await db.query(`SELECT 1 FROM branches WHERE id = $1 AND salon_id = $2`, [branchId, salonId]);
    return rows.length > 0;
  },

  async findStaff(staffId: string, salonId: string, db: Db = pool): Promise<{ id: string; name: string; is_active: boolean } | null> {
    const { rows } = await db.query(
      `SELECT id, ${STAFF_NAME("s")} AS name, is_active FROM staff s WHERE s.id = $1 AND s.salon_id = $2`,
      [staffId, salonId],
    );
    return rows[0] ? { id: rows[0].id, name: rows[0].name ?? "Staff", is_active: rows[0].is_active } : null;
  },

  async userName(userId: string, db: Db = pool): Promise<string | null> {
    const { rows } = await db.query(
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS name FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]?.name ?? null;
  },

  // ── assets ────────────────────────────────────────────────────────────────
  // Serialises code generation per salon so two simultaneous registrations never
  // get the same AST-number (the unique index would reject one otherwise).
  async nextSeq(client: PoolClient, salonId: string): Promise<number> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`asset_seq:${salonId}`]);
    const { rows } = await client.query(`SELECT COALESCE(MAX(asset_seq), 0) + 1 AS n FROM assets WHERE salon_id = $1`, [salonId]);
    return Number(rows[0].n);
  },

  async insert(client: PoolClient, v: {
    salonId: string; branchId: string | null; seq: number; code: string; name: string; category: string | null;
    brand: string | null; model: string | null; serial: string | null; photoUrl: string | null; icon: string | null; receiptUrl: string | null; warrantyUrl: string | null;
    condition: AssetCondition; notes: string | null; userId: string;
  }): Promise<Asset> {
    const { rows } = await client.query(
      `INSERT INTO assets (salon_id, branch_id, asset_seq, asset_code, name, category, brand, model, serial_number,
                           photo_url, icon, receipt_url, warranty_card_url, condition, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'available',$15,$16) RETURNING *`,
      [v.salonId, v.branchId, v.seq, v.code, v.name, v.category, v.brand, v.model, v.serial, v.photoUrl, v.icon, v.receiptUrl, v.warrantyUrl, v.condition, v.notes, v.userId],
    );
    return rows[0];
  },

  async findById(id: string, salonId: string, db: Db = pool, lock = false): Promise<Asset | null> {
    if (lock) {
      // FOR UPDATE can't be combined with the joins' outer side, so lock the bare row first.
      const { rows } = await db.query(`SELECT * FROM assets WHERE id = $1 AND salon_id = $2 FOR UPDATE`, [id, salonId]);
      return rows[0] ?? null;
    }
    const { rows } = await db.query(`SELECT ${ASSET_SELECT} WHERE a.id = $1 AND a.salon_id = $2`, [id, salonId]);
    return rows[0] ?? null;
  },

  async list(salonId: string, f: AssetListFilters): Promise<{ items: Asset[]; total: number }> {
    const where: string[] = ["a.salon_id = $1"];
    const vals: any[] = [salonId];
    const add = (sql: string, v: any) => { vals.push(v); where.push(sql.replace("?", `$${vals.length}`)); };
    if (f.status?.length) add("a.status = ANY(?::text[])", f.status);
    if (f.condition?.length) add("a.condition = ANY(?::text[])", f.condition);
    if (f.category?.length) add("LOWER(a.category) = ANY(?::text[])", f.category.map((c) => c.toLowerCase()));
    if (f.branch_id?.length) add("a.branch_id = ANY(?::uuid[])", f.branch_id);
    if (f.search) {
      vals.push(`%${f.search}%`);
      const i = vals.length;
      where.push(`(a.name ILIKE $${i} OR a.asset_code ILIKE $${i} OR a.serial_number ILIKE $${i} OR a.brand ILIKE $${i} OR a.model ILIKE $${i} OR ${STAFF_NAME("s")} ILIKE $${i})`);
    }
    const page = Math.max(1, f.page ?? 1);
    const limit = Math.min(100, Math.max(1, f.limit ?? 20));
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const from = `FROM assets a LEFT JOIN branches b ON b.id = a.branch_id LEFT JOIN staff s ON s.id = a.current_staff_id ${whereSql}`;
    const [{ rows: cnt }, { rows }] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total ${from}`, vals),
      pool.query(
        `SELECT a.*, b.name AS branch_name, ${STAFF_NAME("s")} AS current_staff_name ${from}
         ORDER BY a.asset_seq DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
        [...vals, limit, (page - 1) * limit],
      ),
    ]);
    return { items: rows, total: Number(cnt[0].total) };
  },

  async categories(salonId: string): Promise<string[]> {
    // Created categories + any already typed onto an asset (older / free-text ones), de-duplicated
    // case-insensitively, keeping the first spelling.
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (LOWER(name)) name FROM (
           SELECT name FROM asset_categories WHERE salon_id = $1
           UNION ALL
           SELECT category AS name FROM assets WHERE salon_id = $1 AND category IS NOT NULL AND category <> ''
         ) c ORDER BY LOWER(name), name`,
        [salonId],
      );
      return rows.map((r) => r.name);
    } catch (e: any) {
      if (e?.code !== "42P01") throw e;   // asset_categories not migrated yet: fall back to categories used on assets
      const { rows } = await pool.query(
        `SELECT DISTINCT category FROM assets WHERE salon_id = $1 AND category IS NOT NULL AND category <> '' ORDER BY category`,
        [salonId],
      );
      return rows.map((r) => r.category);
    }
  },

  async assetsUsingCategory(salonId: string, name: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM assets WHERE salon_id = $1 AND LOWER(category) = LOWER($2)`,
      [salonId, name],
    );
    return Number(rows[0].n);
  },

  async deleteCategory(salonId: string, name: string): Promise<void> {
    await pool.query(`DELETE FROM asset_categories WHERE salon_id = $1 AND LOWER(name) = LOWER($2)`, [salonId, name]);
  },

  // Returns false when the (case-insensitive) name already exists.
  async addCategory(salonId: string, name: string, userId: string): Promise<boolean> {
    const { rows: used } = await pool.query(
      `SELECT 1 FROM assets WHERE salon_id = $1 AND LOWER(category) = LOWER($2) LIMIT 1`,
      [salonId, name],
    );
    if (used.length) return false;
    const { rowCount } = await pool.query(
      `INSERT INTO asset_categories (salon_id, name, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [salonId, name, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  // Whitelisted column update. `patch` keys are trusted (set only by the service).
  async update(client: Db, id: string, salonId: string, patch: Record<string, any>): Promise<Asset> {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
    const { rows } = await client.query(
      `UPDATE assets SET ${sets}${keys.length ? ", " : ""}updated_at = NOW() WHERE id = $1 AND salon_id = $2 RETURNING *`,
      [id, salonId, ...keys.map((k) => patch[k])],
    );
    return rows[0];
  },

  // ── events (append-only) ──────────────────────────────────────────────────
  async addEvent(db: Db, e: {
    salonId: string; assetId: string; type: AssetEventType; staffId?: string | null; branchId?: string | null;
    fromBranchId?: string | null; condition?: AssetCondition | null; fromCondition?: AssetCondition | null;
    statusAfter?: AssetStatus | null; expectedReturnAt?: string | null; incidentId?: string | null;
    notes?: string | null; occurredAt?: string | null; userId: string; userName: string | null;
  }): Promise<void> {
    await db.query(
      `INSERT INTO asset_events (salon_id, asset_id, event_type, staff_id, branch_id, from_branch_id, condition, from_condition,
                                 status_after, expected_return_at, incident_id, notes, occurred_at, recorded_by, recorded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, NOW()),$14,$15)`,
      [e.salonId, e.assetId, e.type, e.staffId ?? null, e.branchId ?? null, e.fromBranchId ?? null, e.condition ?? null,
       e.fromCondition ?? null, e.statusAfter ?? null, e.expectedReturnAt ?? null, e.incidentId ?? null, e.notes ?? null,
       e.occurredAt ?? null, e.userId, e.userName],
    );
  },

  async history(assetId: string, salonId: string): Promise<AssetEvent[]> {
    const { rows } = await pool.query(
      `SELECT e.*, ${STAFF_NAME("s")} AS staff_name, b.name AS branch_name, fb.name AS from_branch_name
         FROM asset_events e
         LEFT JOIN staff s ON s.id = e.staff_id
         LEFT JOIN branches b ON b.id = e.branch_id
         LEFT JOIN branches fb ON fb.id = e.from_branch_id
        WHERE e.asset_id = $1 AND e.salon_id = $2
        ORDER BY e.occurred_at DESC, e.created_at DESC`,
      [assetId, salonId],
    );
    return rows;
  },

  // ── incidents ─────────────────────────────────────────────────────────────
  async insertIncident(client: Db, v: {
    salonId: string; assetId: string; type: IncidentType; reportedAt: string | null; lastStaffId: string | null;
    lastCondition: AssetCondition | null; description: string; photoUrl: string | null; userId: string;
  }): Promise<AssetIncident> {
    const { rows } = await client.query(
      `INSERT INTO asset_incidents (salon_id, asset_id, incident_type, reported_at, last_staff_id, last_condition, description, photo_url, reported_by)
       VALUES ($1,$2,$3,COALESCE($4::timestamptz, NOW()),$5,$6,$7,$8,$9) RETURNING *`,
      [v.salonId, v.assetId, v.type, v.reportedAt, v.lastStaffId, v.lastCondition, v.description, v.photoUrl, v.userId],
    );
    return rows[0];
  },

  async findIncident(id: string, salonId: string, db: Db = pool, lock = false): Promise<AssetIncident | null> {
    const { rows } = await db.query(
      `SELECT * FROM asset_incidents WHERE id = $1 AND salon_id = $2${lock ? " FOR UPDATE" : ""}`,
      [id, salonId],
    );
    return rows[0] ?? null;
  },

  async listIncidents(salonId: string, f: { status?: InvestigationStatus; asset_id?: string; open_only?: boolean }): Promise<AssetIncident[]> {
    const where = ["i.salon_id = $1"];
    const vals: any[] = [salonId];
    if (f.status) { vals.push(f.status); where.push(`i.investigation_status = $${vals.length}`); }
    if (f.asset_id) { vals.push(f.asset_id); where.push(`i.asset_id = $${vals.length}`); }
    if (f.open_only) where.push(`i.investigation_status IN ('open','investigating')`);
    const { rows } = await pool.query(
      `SELECT i.*, a.asset_code, a.name AS asset_name, ${STAFF_NAME("s")} AS last_staff_name,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.email) AS reported_by_name
         FROM asset_incidents i
         JOIN assets a ON a.id = i.asset_id
         LEFT JOIN staff s ON s.id = i.last_staff_id
         LEFT JOIN users u ON u.id = i.reported_by
        WHERE ${where.join(" AND ")}
        ORDER BY i.reported_at DESC`,
      vals,
    );
    return rows;
  },

  async updateIncident(client: Db, id: string, v: { status: InvestigationStatus; notes: string | null; userId: string; resolved: boolean }): Promise<AssetIncident> {
    const { rows } = await client.query(
      `UPDATE asset_incidents
          SET investigation_status = $2,
              resolution_notes = COALESCE($3, resolution_notes),
              resolved_by = CASE WHEN $5 THEN $4 ELSE resolved_by END,
              resolved_at = CASE WHEN $5 THEN NOW() ELSE resolved_at END,
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, v.status, v.notes, v.userId, v.resolved],
    );
    return rows[0];
  },

  // Inspection cleared = the damage was looked at and the asset is usable again, so its open damage
  // reports are closed with that note. (Missing reports are never touched here.)
  async resolveOpenDamage(client: Db, assetId: string, userId: string, note: string): Promise<number> {
    const { rowCount } = await client.query(
      `UPDATE asset_incidents
          SET investigation_status = 'resolved', resolution_notes = COALESCE(resolution_notes, $3),
              resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
        WHERE asset_id = $1 AND incident_type = 'damaged' AND investigation_status IN ('open','investigating')`,
      [assetId, userId, note],
    );
    return rowCount ?? 0;
  },

  async openIncidentCount(assetId: string, type: IncidentType, client: Db): Promise<number> {
    const { rows } = await client.query(
      `SELECT COUNT(*) AS n FROM asset_incidents
        WHERE asset_id = $1 AND incident_type = $2 AND investigation_status IN ('open','investigating')`,
      [assetId, type],
    );
    return Number(rows[0].n);
  },
};
