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

export interface InactivityFilters {
  /** Only clients with no activity for at least this many days (and clients that never used it). 0 = everyone. */
  inactiveDays: number;
  accountType?: "demo" | "real";
  platform?: "web" | "app";
  search?: string;
  sort: "last_activity" | "days_inactive";
  dir: "asc" | "desc";
  page: number;
  limit: number;
}

export const clientActivityRepository = {
  /**
   * One row per salon (client): its latest tracked activity across all its users, the platform that activity came from, and how many
   * days ago it was. Tracked activity already excludes background polling (see client-activity.tracker.ts). A salon whose users logged in
   * before tracking existed falls back to users.last_login (platform unknown); a salon with neither is "never used". With a platform
   * filter only that platform's tracked activity counts, so a client who only ever used the other platform shows as never used there.
   */
  async bySalon(f: InactivityFilters) {
    const params: any[] = [];
    const add = (v: any) => { params.push(v); return `$${params.length}`; };

    const platformSql = f.platform ? `AND cas.platform = ${add(f.platform)}` : "";
    const where: string[] = [`COALESCE(s.is_active, TRUE) = TRUE`];
    if (f.accountType) where.push(`COALESCE(s.is_dummy, FALSE) = ${f.accountType === "demo" ? "TRUE" : "FALSE"}`);
    if (f.search) {
      const p = add(`%${f.search}%`);
      where.push(`(COALESCE(s.business_name, s.slug, '') ILIKE ${p} OR COALESCE(owner.email, '') ILIKE ${p} OR COALESCE(s.slug, '') ILIKE ${p})`);
    }

    const base = `
      WITH tracked AS (
        SELECT x.salon_id, x.platform, x.last_activity_at,
               ROW_NUMBER() OVER (PARTITION BY x.salon_id ORDER BY x.last_activity_at DESC) AS rn
          FROM (
            SELECT COALESCE(cas.salon_id, u.salon_id, (SELECT o.id FROM salons o WHERE o.owner_id = u.id LIMIT 1)) AS salon_id,
                   cas.platform, cas.last_activity_at
              FROM client_activity_summary cas
              JOIN users u ON u.id = cas.user_id
             WHERE u.role <> 'super_admin' AND cas.last_activity_at IS NOT NULL ${platformSql}
          ) x
         WHERE x.salon_id IS NOT NULL
      ),
      legacy AS (
        SELECT s2.id AS salon_id, MAX(u.last_login) AS last_login
          FROM users u JOIN salons s2 ON s2.id = u.salon_id OR s2.owner_id = u.id
         WHERE u.role <> 'super_admin' AND u.last_login IS NOT NULL ${f.platform ? "AND FALSE" : ""}
         GROUP BY s2.id
      ),
      base AS (
        SELECT s.id AS salon_id,
               COALESCE(NULLIF(TRIM(s.business_name), ''), s.slug) AS salon_name,
               COALESCE(s.is_dummy, FALSE) AS is_dummy,
               owner.email AS owner_email,
               s.created_at,
               COALESCE(t.last_activity_at, l.last_login) AS last_activity_at,
               t.platform AS platform,
               CASE WHEN COALESCE(t.last_activity_at, l.last_login) IS NULL THEN NULL
                    ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(t.last_activity_at, l.last_login))) / 86400)::int END AS days_inactive
          FROM salons s
          LEFT JOIN users owner ON owner.id = s.owner_id
          LEFT JOIN tracked t ON t.salon_id = s.id AND t.rn = 1
          LEFT JOIN legacy l ON l.salon_id = s.id
         WHERE ${where.join(" AND ")}
      )`;

    const inactive = f.inactiveDays > 0 ? `WHERE days_inactive IS NULL OR days_inactive >= ${add(f.inactiveDays)}` : "";
    const order = f.sort === "last_activity"
      ? `last_activity_at ${f.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`
      : `last_activity_at ${f.dir === "desc" ? "ASC NULLS FIRST" : "DESC NULLS LAST"}`;   // most days inactive = oldest activity; never used counts as the most
    const limitP = add(f.limit);
    const offsetP = add((f.page - 1) * f.limit);

    const [{ rows }, { rows: sum }] = await Promise.all([
      pool.query(
        `${base} SELECT *, (COUNT(*) OVER())::int AS total FROM base ${inactive} ORDER BY ${order}, salon_name ASC LIMIT ${limitP} OFFSET ${offsetP}`,
        params,
      ),
      pool.query(
        `${base} SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE last_activity_at IS NULL)::int AS never_used FROM base`,
        params.slice(0, params.length - (f.inactiveDays > 0 ? 3 : 2)),
      ),
    ]);
    return {
      items: rows.map(({ total: _t, ...r }: any) => r),
      total: (rows[0]?.total as number) ?? 0,
      summary: { total: sum[0]?.total ?? 0, never_used: sum[0]?.never_used ?? 0 },
    };
  },

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
