import pool from "../../config/database";

export type StatusFilter = "online" | "active" | "inactive";

export interface ActivityListFilters {
  from: Date;
  to: Date;
  platform?: "web" | "app";
  status?: StatusFilter;
  search?: string;
  page: number;
  limit: number;
}

// Status is derived from what was actually tracked, never stored:
//   online   - activity in the last 10 minutes and no logout after it
//   active   - activity inside the selected date range
//   inactive - tracked, but nothing inside the selected range
const STATUS_SQL = (fromIdx: number, toIdx: number) => `
  CASE
    WHEN cas.last_activity_at >= NOW() - INTERVAL '10 minutes'
         AND (cas.last_logout_at IS NULL OR cas.last_activity_at > cas.last_logout_at) THEN 'online'
    WHEN cas.last_activity_at BETWEEN $${fromIdx} AND $${toIdx} THEN 'active'
    ELSE 'inactive'
  END`;

const NAME_SQL = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), NULLIF(TRIM(u.full_name), ''), u.email)`;

function baseQuery(f: ActivityListFilters) {
  const params: any[] = [f.from.toISOString(), f.to.toISOString()];
  const where: string[] = [`u.role <> 'super_admin'`];
  if (f.platform) { params.push(f.platform); where.push(`cas.platform = $${params.length}`); }
  if (f.search) {
    params.push(`%${f.search}%`);
    const i = params.length;
    where.push(`(u.email ILIKE $${i} OR ${NAME_SQL} ILIKE $${i} OR COALESCE(s.business_name, s.slug, '') ILIKE $${i})`);
  }
  const sql = `
    SELECT
      cas.user_id, cas.platform, cas.first_login_at, cas.last_login_at, cas.last_logout_at, cas.last_activity_at,
      cas.login_count, cas.last_module,
      ${NAME_SQL} AS name, u.email, u.role,
      s.id AS salon_id, COALESCE(s.business_name, s.slug) AS salon_name,
      (SELECT COUNT(*)::int FROM client_activity_events e
        WHERE e.user_id = cas.user_id AND e.platform = cas.platform AND e.event_type = 'login'
          AND e.occurred_at BETWEEN $1 AND $2) AS logins_in_range,
      ${STATUS_SQL(1, 2)} AS status
    FROM client_activity_summary cas
    JOIN users u ON u.id = cas.user_id
    LEFT JOIN salons s ON s.id = COALESCE(cas.salon_id, u.salon_id, (SELECT o.id FROM salons o WHERE o.owner_id = u.id LIMIT 1))
    WHERE ${where.join(" AND ")}`;
  return { sql, params };
}

export const clientActivityRepository = {
  async list(f: ActivityListFilters) {
    const { sql, params } = baseQuery(f);

    const statusClause = f.status ? `WHERE status = $${params.length + 1}` : "";
    const statusParams = f.status ? [f.status] : [];
    const offset = (f.page - 1) * f.limit;

    const [{ rows }, { rows: counts }] = await Promise.all([
      pool.query(
        `WITH base AS (${sql})
         SELECT *, (COUNT(*) OVER())::int AS total FROM base ${statusClause}
         ORDER BY last_activity_at DESC NULLS LAST
         LIMIT $${params.length + statusParams.length + 1} OFFSET $${params.length + statusParams.length + 2}`,
        [...params, ...statusParams, f.limit, offset],
      ),
      // Counts over everything that matches the platform/search/range (ignoring the status filter), for the summary chips.
      pool.query(
        `WITH base AS (${sql})
         SELECT status, platform, COUNT(*)::int AS n FROM base GROUP BY status, platform`,
        params,
      ),
    ]);

    const summary: Record<string, number> = { online: 0, active: 0, inactive: 0, web: 0, app: 0, total: 0 };
    for (const c of counts) {
      summary[c.status] += c.n;
      summary[c.platform] += c.n;
      summary.total += c.n;
    }
    return { items: rows.map(({ total: _t, ...r }: any) => r), total: (rows[0]?.total as number) ?? 0, summary };
  },

  async userHeader(userId: string) {
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, ${NAME_SQL} AS name, u.email, u.role, s.id AS salon_id, COALESCE(s.business_name, s.slug) AS salon_name
         FROM users u LEFT JOIN salons s ON s.id = COALESCE(u.salon_id, (SELECT o.id FROM salons o WHERE o.owner_id = u.id LIMIT 1))
        WHERE u.id = $1 AND u.role <> 'super_admin'`,
      [userId],
    );
    return rows[0] ?? null;
  },

  async userPlatforms(userId: string, from: Date, to: Date) {
    const { rows } = await pool.query(
      `SELECT cas.platform, cas.first_login_at, cas.last_login_at, cas.last_logout_at, cas.last_activity_at, cas.login_count,
              cas.last_module, cas.last_ip, cas.last_user_agent,
              ${STATUS_SQL(2, 3)} AS status
         FROM client_activity_summary cas
        WHERE cas.user_id = $1
        ORDER BY cas.platform`,
      [userId, from.toISOString(), to.toISOString()],
    );
    return rows;
  },

  async userEvents(userId: string, f: { from: Date; to: Date; platform?: "web" | "app"; page: number; limit: number }) {
    const params: any[] = [userId, f.from.toISOString(), f.to.toISOString()];
    let platformSql = "";
    if (f.platform) { params.push(f.platform); platformSql = `AND platform = $${params.length}`; }
    const where = `user_id = $1 AND occurred_at BETWEEN $2 AND $3 ${platformSql}`;
    const [{ rows }, { rows: cnt }] = await Promise.all([
      pool.query(
        `SELECT id::text, platform, event_type, module, ip, user_agent, occurred_at
           FROM client_activity_events WHERE ${where}
          ORDER BY occurred_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, f.limit, (f.page - 1) * f.limit],
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM client_activity_events WHERE ${where}`, params),
    ]);
    return { items: rows, total: cnt[0].n as number };
  },
};
