import pool from "../../config/database";

// Super Admin > Client Activity Management > Developer Activity: what each developer (a team member with a login) has done in
// this module, read from the audit trail, plus a per-developer summary of their assigned work. Super Admin only (parent router).

type Page = { page: number; limit: number };
export interface DeveloperActivityFilters { developerIds?: string[]; entityTypes?: string[]; from?: string; to?: string; search?: string }

const SALON_NAME = `COALESCE(s.business_name, s.slug)`;
const USER_NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)`;

export const developerActivity = {
  /** One row per active developer: their login, what they did, and the work assigned to them. Dates narrow the counts. */
  async summary(f: { from?: string; to?: string }) {
    const { rows } = await pool.query(
      `SELECT d.id AS developer_id, d.name, d.email, d.is_active, d.user_id,
              u.is_active AS login_active, u.last_login,
              (SELECT COUNT(*)::int FROM client_activity_audit_logs l WHERE l.changed_by = d.user_id
                 AND ($1::date IS NULL OR l.changed_at >= $1::date) AND ($2::date IS NULL OR l.changed_at < ($2::date + 1))) AS actions,
              (SELECT MAX(l.changed_at) FROM client_activity_audit_logs l WHERE l.changed_by = d.user_id) AS last_action_at,
              GREATEST((SELECT MAX(l.changed_at) FROM client_activity_audit_logs l WHERE l.changed_by = d.user_id), u.last_login) AS last_activity_at,
              (SELECT COUNT(*)::int FROM client_meetings m WHERE m.developer_id = d.id
                 AND ($1::date IS NULL OR m.meeting_date >= $1::date) AND ($2::date IS NULL OR m.meeting_date <= $2::date)) AS meetings_assigned,
              (SELECT COUNT(*)::int FROM client_meetings m WHERE m.developer_id = d.id AND m.status = 'completed'
                 AND ($1::date IS NULL OR m.meeting_date >= $1::date) AND ($2::date IS NULL OR m.meeting_date <= $2::date)) AS meetings_completed,
              (SELECT COUNT(*)::int FROM client_followup_tasks t WHERE t.developer_id = d.id AND t.status IN ('pending','in_progress')) AS open_followups,
              (SELECT COUNT(*)::int FROM client_followup_tasks t WHERE t.developer_id = d.id AND t.status IN ('pending','in_progress') AND t.due_date < CURRENT_DATE) AS overdue_followups
         FROM developers d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.is_active
        ORDER BY actions DESC, d.name`,
      [f.from ?? null, f.to ?? null],
    );
    return rows;
  },

  /** The feed: every audited action taken by a developer's login, newest first, with the record it touched. */
  async feed(f: DeveloperActivityFilters & Page) {
    const params: any[] = [];
    const where: string[] = [];
    const add = (sql: (i: number) => string, v: any) => { params.push(v); where.push(sql(params.length)); };
    if (f.developerIds?.length) add((i) => `d.id::text = ANY($${i}::text[])`, f.developerIds);
    if (f.entityTypes?.length) add((i) => `l.entity_type = ANY($${i}::text[])`, f.entityTypes);
    if (f.from) add((i) => `l.changed_at >= $${i}::date`, f.from);
    if (f.to) add((i) => `l.changed_at < ($${i}::date + 1)`, f.to);
    if (f.search) add((i) => `(${SALON_NAME} ILIKE $${i} OR ${USER_NAME} ILIKE $${i})`, `%${f.search}%`);
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countParams = [...params];
    params.push(f.limit, (f.page - 1) * f.limit);
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(
        `SELECT l.id, l.action, l.entity_type, l.entity_id, l.previous_values, l.new_values, l.changed_at, l.salon_id, ${SALON_NAME} AS salon_name,
                d.id AS developer_id, d.name AS developer_name, ${USER_NAME} AS user_name,
                CASE l.entity_type
                  WHEN 'meeting'  THEN (SELECT title FROM client_meetings WHERE id = l.entity_id)
                  WHEN 'task'     THEN (SELECT title FROM client_followup_tasks WHERE id = l.entity_id)
                  WHEN 'activity' THEN (SELECT LEFT(description, 80) FROM client_activity_logs WHERE id = l.entity_id)
                  WHEN 'training' THEN (SELECT mo.name FROM client_training_progress p JOIN client_training_modules mo ON mo.id = p.module_id WHERE p.id = l.entity_id)
                END AS subject
           FROM client_activity_audit_logs l
           JOIN users u ON u.id = l.changed_by
           JOIN developers d ON d.user_id = u.id
           LEFT JOIN salons s ON s.id = l.salon_id
           ${w} ORDER BY l.changed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM client_activity_audit_logs l JOIN users u ON u.id = l.changed_by JOIN developers d ON d.user_id = u.id
           LEFT JOIN salons s ON s.id = l.salon_id ${w}`,
        countParams,
      ),
    ]);
    return { items: rows, total: c[0].n as number };
  },
};
