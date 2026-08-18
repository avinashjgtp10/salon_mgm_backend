import bcrypt from "bcrypt";
import pool, { safeQuery } from "../../config/database";
import { SalonGroup, GroupAdminSalonCard, GroupSummary } from "./salon-groups.types";

// A single salon_group row plus all its member salons, one row per member
// (or one row with salon fields all NULL for an empty group) — collapsed
// into SalonGroup[] by mapGroupRows below.
const GROUP_WITH_SALONS_SELECT = `
  SELECT
    sg.id,
    sg.owner_id,
    TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS owner_name,
    u.email                                                   AS owner_email,
    sg.name,
    sg.created_at,
    sg.updated_at,
    s.id                                                       AS salon_id,
    COALESCE(s.business_name, s.slug, 'Unnamed')               AS salon_name,
    CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END   AS salon_status,
    (SELECT bp.name FROM billing_subscriptions bs
       JOIN billing_plans bp ON bp.id = bs.plan_id
       WHERE bs.salon_id = s.id AND bs.status IN ('active','trialing')
       ORDER BY bs.created_at DESC LIMIT 1)                    AS salon_plan_name
  FROM salon_groups sg
  JOIN users u ON u.id = sg.owner_id
  LEFT JOIN salon_group_members sgm ON sgm.salon_group_id = sg.id
  LEFT JOIN salons s ON s.id = sgm.salon_id
`;

function mapGroupRows(rows: any[]): SalonGroup[] {
  const byId = new Map<string, SalonGroup>();
  for (const row of rows) {
    let group = byId.get(row.id);
    if (!group) {
      group = {
        id: row.id,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        owner_email: row.owner_email,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        salons: [],
      };
      byId.set(row.id, group);
    }
    if (row.salon_id) {
      group.salons.push({
        id: row.salon_id,
        name: row.salon_name,
        status: row.salon_status,
        plan_name: row.salon_plan_name,
      });
    }
  }
  return [...byId.values()];
}

export const salonGroupsRepository = {
  async list(search?: string): Promise<SalonGroup[]> {
    const param = search ? `%${search.trim()}%` : "%";
    const { rows } = await safeQuery(() =>
      pool.query(
        `${GROUP_WITH_SALONS_SELECT}
         WHERE sg.name ILIKE $1 OR u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
         ORDER BY sg.created_at DESC`,
        [param]
      )
    );
    return mapGroupRows(rows);
  },

  async getById(id: string): Promise<SalonGroup | null> {
    const { rows } = await safeQuery(() =>
      pool.query(`${GROUP_WITH_SALONS_SELECT} WHERE sg.id = $1`, [id])
    );
    const groups = mapGroupRows(rows);
    return groups[0] ?? null;
  },

  async create(name: string, ownerId: string): Promise<{ id: string }> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `INSERT INTO salon_groups (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [name, ownerId]
      )
    );
    return rows[0];
  },

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await safeQuery(() =>
      pool.query(`DELETE FROM salon_groups WHERE id = $1`, [id])
    );
    return (rowCount ?? 0) > 0;
  },

  async countMembers(groupId: string): Promise<number> {
    const { rows } = await safeQuery(() =>
      pool.query(`SELECT COUNT(*)::int AS count FROM salon_group_members WHERE salon_group_id = $1`, [groupId])
    );
    return rows[0]?.count ?? 0;
  },

  // Returns the group's owner_id (for verifying the salon being added is
  // actually owned by the same person) or null if the group doesn't exist.
  async getOwnerId(groupId: string): Promise<string | null> {
    const { rows } = await safeQuery(() =>
      pool.query(`SELECT owner_id FROM salon_groups WHERE id = $1`, [groupId])
    );
    return rows[0]?.owner_id ?? null;
  },

  async getSalonOwnerId(salonId: string): Promise<string | null> {
    const { rows } = await safeQuery(() =>
      pool.query(`SELECT owner_id FROM salons WHERE id = $1`, [salonId])
    );
    return rows[0]?.owner_id ?? null;
  },

  // A salon can belong to at most one group (salon_group_members.salon_id is
  // UNIQUE) — this returns whichever group (if any) already claims it.
  async getExistingGroupIdForSalon(salonId: string): Promise<string | null> {
    const { rows } = await safeQuery(() =>
      pool.query(`SELECT salon_group_id FROM salon_group_members WHERE salon_id = $1`, [salonId])
    );
    return rows[0]?.salon_group_id ?? null;
  },

  async addSalon(groupId: string, salonId: string): Promise<void> {
    await safeQuery(() =>
      pool.query(
        `INSERT INTO salon_group_members (salon_group_id, salon_id) VALUES ($1, $2)`,
        [groupId, salonId]
      )
    );
  },

  async removeSalon(groupId: string, salonId: string): Promise<boolean> {
    const { rowCount } = await safeQuery(() =>
      pool.query(
        `DELETE FROM salon_group_members WHERE salon_group_id = $1 AND salon_id = $2`,
        [groupId, salonId]
      )
    );
    return (rowCount ?? 0) > 0;
  },

  // Every salon in the same group as `salonId` (including itself), or just
  // `salonId` alone if it isn't in any group — the candidate set for
  // "switch active branch". Used by auth.service.ts's switchSalon/
  // getMySalonGroup, not by the Super Admin CRUD endpoints above.
  async getGroupSalonsForSalon(salonId: string): Promise<{ id: string; name: string }[]> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT s.id, COALESCE(s.business_name, s.slug, 'Unnamed') AS name
         FROM salon_group_members sgm
         JOIN salons s ON s.id = sgm.salon_id
         WHERE sgm.salon_group_id = (
           SELECT salon_group_id FROM salon_group_members WHERE salon_id = $1
         )
         ORDER BY s.business_name ASC`,
        [salonId]
      )
    );
    if (rows.length > 0) return rows;

    // Not in any group — the only "switchable" salon is itself, if it exists.
    const { rows: soloRows } = await safeQuery(() =>
      pool.query(
        `SELECT id, COALESCE(business_name, slug, 'Unnamed') AS name FROM salons WHERE id = $1`,
        [salonId]
      )
    );
    return soloRows;
  },

  // Full salon cards for every salon in the same group as `salonId` — the
  // data source for the Group Admin mini-panel's branch list. Returns null
  // (not an empty array) when `salonId` isn't in any group at all, so the
  // caller can distinguish "genuinely ungrouped" from "grouped but somehow
  // has zero members" — the security/access-gate signal for /group-admin.
  async getGroupDetailsForSalon(salonId: string): Promise<GroupAdminSalonCard[] | null> {
    const { rows: groupRows } = await safeQuery(() =>
      pool.query(`SELECT salon_group_id FROM salon_group_members WHERE salon_id = $1`, [salonId])
    );
    const groupId = groupRows[0]?.salon_group_id;
    if (!groupId) return null;

    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT
           s.id,
           COALESCE(s.business_name, s.slug, 'Unnamed')             AS name,
           COALESCE(s.email, u.email)                                AS email,
           CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END AS status,
           (SELECT bp.name FROM billing_subscriptions bs
              JOIN billing_plans bp ON bp.id = bs.plan_id
              WHERE bs.salon_id = s.id AND bs.status IN ('active','trialing')
              ORDER BY bs.created_at DESC LIMIT 1)                  AS plan_name,
           (SELECT COUNT(*)::int FROM staff   WHERE salon_id = s.id) AS staff_count,
           (SELECT COUNT(*)::int FROM clients WHERE salon_id = s.id) AS client_count,
           COALESCE((
             SELECT SUM(net_amount) FROM payments
             WHERE salon_id = s.id AND status IN ('completed','partial')
           ), 0)::numeric                                            AS revenue,
           s.created_at
         FROM salon_group_members sgm
         JOIN salons s ON s.id = sgm.salon_id
         LEFT JOIN users u ON u.id = s.owner_id
         WHERE sgm.salon_group_id = $1
         ORDER BY s.business_name ASC`,
        [groupId]
      )
    );
    return rows;
  },

  // Every salon owned by ownerId that is NOT already in another group —
  // the candidate list for "add a salon to this group".
  async getUngroupedSalonsForOwner(ownerId: string): Promise<{ id: string; name: string }[]> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT s.id, COALESCE(s.business_name, s.slug, 'Unnamed') AS name
         FROM salons s
         WHERE s.owner_id = $1
           AND NOT EXISTS (SELECT 1 FROM salon_group_members sgm WHERE sgm.salon_id = s.id)
         ORDER BY s.business_name ASC`,
        [ownerId]
      )
    );
    return rows;
  },

  // Looks up which user (if any) already holds this email, excluding the
  // group owner themself — used to give a friendly "email already in use"
  // error instead of surfacing the raw 23505 constraint violation.
  async findUserByEmailExcluding(email: string, excludingUserId: string): Promise<{ id: string } | null> {
    const { rows } = await safeQuery(() =>
      pool.query(`SELECT id FROM users WHERE email = $1 AND id != $2`, [email, excludingUserId])
    );
    return rows[0] ?? null;
  },

  // Sets the group owner's branch-owner login credentials (email + password).
  // Same account used everywhere else for this person — this doesn't create
  // a second identity, it (re)provisions the one salon_owner account's login
  // so Super Admin can hand it out as a distinct "branch owner" credential.
  async setOwnerCredentials(userId: string, email: string, password: string): Promise<void> {
    const hash = await bcrypt.hash(password, 10);
    await safeQuery(() =>
      pool.query(
        `UPDATE users SET email = $1, password_hash = $2, updated_at = NOW() WHERE id = $3`,
        [email, hash, userId]
      )
    );
  },

  // Aggregated totals across every salon in the group containing `salonId` —
  // the rollup shown at the top of the Group Admin dashboard. Mirrors the
  // per-salon subqueries in getGroupDetailsForSalon above, summed instead of
  // returned per-row.
  async getGroupSummaryForSalon(salonId: string): Promise<GroupSummary | null> {
    const { rows: groupRows } = await safeQuery(() =>
      pool.query(`SELECT salon_group_id FROM salon_group_members WHERE salon_id = $1`, [salonId])
    );
    const groupId = groupRows[0]?.salon_group_id;
    if (!groupId) return null;

    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT
           COUNT(*)::int AS salon_count,
           COALESCE(SUM(
             (SELECT COUNT(*)::int FROM staff WHERE salon_id = s.id)
           ), 0)::int AS total_staff,
           COALESCE(SUM(
             (SELECT COUNT(*)::int FROM clients WHERE salon_id = s.id)
           ), 0)::int AS total_clients,
           COALESCE(SUM(
             (SELECT COUNT(*)::int FROM appointments WHERE salon_id = s.id)
           ), 0)::int AS total_appointments,
           COALESCE(SUM(
             (SELECT SUM(net_amount) FROM payments
              WHERE salon_id = s.id AND status IN ('completed','partial'))
           ), 0)::numeric AS total_revenue
         FROM salon_group_members sgm
         JOIN salons s ON s.id = sgm.salon_id
         WHERE sgm.salon_group_id = $1`,
        [groupId]
      )
    );
    return rows[0] ?? null;
  },
};
