import { PoolClient } from "pg";
import pool from "../../config/database";

// Super Admin > Client Activity Management. Team members are the existing `developers` directory (no login).
// DATE / TIME columns are cast to text in SQL so they reach the browser as "YYYY-MM-DD" / "HH:MM" with no timezone shift.

export const MEETING_TYPES = ["client_meeting", "product_training", "technical_support", "on_site_visit", "online_meeting", "phone_discussion", "implementation", "follow_up"] as const;
export const MEETING_MODES = ["on_site", "online", "phone"] as const;
export const MEETING_STATUSES = ["scheduled", "completed", "rescheduled", "cancelled", "not_conducted"] as const;
export const TRAINING_STATUSES = ["not_started", "scheduled", "in_progress", "completed", "needs_retraining"] as const;
export const UNDERSTANDING = ["good", "average", "needs_more_training"] as const;
export const ACTIVITY_TYPES = ["meeting", "training", "salon_visit", "phone_call", "whatsapp_discussion", "technical_support", "implementation", "client_feedback", "general"] as const;
export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const ATTACHMENT_ENTITIES = ["meeting", "training", "activity", "task"] as const;

const SALON_NAME = `COALESCE(s.business_name, s.slug)`;
const T = (col: string) => `to_char(${col}, 'HH24:MI')`;

const MEETING_SELECT = `
  m.id, m.salon_id, ${SALON_NAME} AS salon_name, m.developer_id, d.name AS developer_name,
  NULLIF(CONCAT_WS(', ', NULLIF(TRIM(s.city), ''), NULLIF(TRIM(s.state), ''), NULLIF(TRIM(s.country), '')), '') AS salon_location,
  m.title, m.meeting_type, m.meeting_date::text AS meeting_date, ${T("m.start_time")} AS start_time, ${T("m.end_time")} AS end_time,
  m.meeting_mode, m.location_or_link, m.purpose, m.agenda, m.internal_notes, m.status,
  m.actual_date::text AS actual_date, ${T("m.actual_start_time")} AS actual_start_time, ${T("m.actual_end_time")} AS actual_end_time,
  m.discussion_summary, m.training_provided, m.work_completed, m.client_feedback, m.issues_discussed, m.pending_actions,
  m.next_followup_date::text AS next_followup_date, m.completed_at, m.created_at, m.updated_at,
  COALESCE((SELECT json_agg(a.name ORDER BY a.created_at) FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.kind = 'invited'), '[]') AS attendees,
  COALESCE((SELECT json_agg(a.name ORDER BY a.created_at) FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.kind = 'present'), '[]') AS attendees_present
  FROM client_meetings m
  JOIN salons s ON s.id = m.salon_id
  LEFT JOIN developers d ON d.id = m.developer_id`;

const TASK_SELECT = `
  t.id, t.salon_id, ${SALON_NAME} AS salon_name, t.developer_id, d.name AS developer_name, t.title, t.description, t.priority,
  t.due_date::text AS due_date, t.status, t.completion_notes, t.completed_at, t.created_at, t.updated_at,
  (t.status IN ('pending','in_progress') AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE) AS is_overdue
  FROM client_followup_tasks t
  JOIN salons s ON s.id = t.salon_id
  LEFT JOIN developers d ON d.id = t.developer_id`;

const ACTIVITY_SELECT = `
  a.id, a.salon_id, ${SALON_NAME} AS salon_name, a.developer_id, d.name AS developer_name, a.activity_type, a.activity_date,
  a.description, a.work_completed, a.pending_work, a.next_followup::text AS next_followup, a.source_type, a.source_id,
  a.created_by, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS created_by_name, a.created_at, a.updated_at,
  (SELECT COUNT(*)::int FROM client_activity_attachments x WHERE x.entity_type = 'activity' AND x.entity_id = a.id) AS attachment_count
  FROM client_activity_logs a
  JOIN salons s ON s.id = a.salon_id
  LEFT JOIN developers d ON d.id = a.developer_id
  LEFT JOIN users u ON u.id = a.created_by`;

type Q = { where: string[]; params: any[] };
const q = (): Q => ({ where: [], params: [] });
const add = (x: Q, clause: (i: number) => string, value: any) => { x.params.push(value); x.where.push(clause(x.params.length)); };
const whereSql = (x: Q) => (x.where.length ? `WHERE ${x.where.join(" AND ")}` : "");

export interface Page { page: number; limit: number }
const paging = (x: Q, p: Page) => { x.params.push(p.limit, (p.page - 1) * p.limit); return `LIMIT $${x.params.length - 1} OFFSET $${x.params.length}`; };

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function audit(c: PoolClient | typeof pool, salonId: string, entityType: string, entityId: string, action: string, prev: any, next: any, by: string | null) {
  await c.query(
    `INSERT INTO client_activity_audit_logs (salon_id, entity_type, entity_id, action, previous_values, new_values, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [salonId, entityType, entityId, action, prev == null ? null : JSON.stringify(prev), next == null ? null : JSON.stringify(next), by],
  );
}

/** Only the fields whose value actually changed, as { previous, next }. */
function diff(before: Record<string, any>, after: Record<string, any>, keys: string[]) {
  const previous: Record<string, any> = {}; const next: Record<string, any> = {};
  for (const k of keys) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) { previous[k] = before[k] ?? null; next[k] = after[k] ?? null; }
  }
  return { previous, next, changed: Object.keys(next).length > 0 };
}

export const clientManagementRepository = {
  async salonExists(id: string): Promise<boolean> {
    const { rows } = await pool.query(`SELECT 1 FROM salons WHERE id = $1`, [id]);
    return rows.length > 0;
  },
  async developerExists(id: string): Promise<boolean> {
    const { rows } = await pool.query(`SELECT 1 FROM developers WHERE id = $1`, [id]);
    return rows.length > 0;
  },

  // ── Meetings ────────────────────────────────────────────────────────────────
  async listMeetings(f: { salonId?: string[]; developerId?: string[]; type?: string[]; status?: string[]; from?: string; to?: string; search?: string } & Page) {
    const x = q();
    if (f.salonId?.length) add(x, (i) => `m.salon_id::text = ANY($${i}::text[])`, f.salonId);
    if (f.developerId?.length) add(x, (i) => `m.developer_id::text = ANY($${i}::text[])`, f.developerId);
    if (f.type?.length) add(x, (i) => `m.meeting_type = ANY($${i}::text[])`, f.type);
    if (f.status?.length) add(x, (i) => `m.status = ANY($${i}::text[])`, f.status);
    if (f.from) add(x, (i) => `m.meeting_date >= $${i}::date`, f.from);
    if (f.to) add(x, (i) => `m.meeting_date <= $${i}::date`, f.to);
    if (f.search) add(x, (i) => `(m.title ILIKE $${i} OR ${SALON_NAME} ILIKE $${i} OR m.salon_id::text ILIKE $${i})`, `%${f.search}%`);
    const w = whereSql(x);
    const countParams = [...x.params];
    const lim = paging(x, f);
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(`SELECT ${MEETING_SELECT} ${w} ORDER BY m.meeting_date DESC, m.start_time DESC NULLS LAST ${lim}`, x.params),
      pool.query(`SELECT COUNT(*)::int AS n FROM client_meetings m JOIN salons s ON s.id = m.salon_id ${w}`, countParams),
    ]);
    return { items: rows, total: c[0].n as number };
  },

  async getMeeting(id: string) {
    const { rows } = await pool.query(`SELECT ${MEETING_SELECT} WHERE m.id = $1`, [id]);
    return rows[0] ?? null;
  },

  async createMeeting(input: any, by: string) {
    return tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO client_meetings (salon_id, developer_id, title, meeting_type, meeting_date, start_time, end_time, meeting_mode,
           location_or_link, purpose, agenda, internal_notes, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
        [input.salon_id, input.developer_id, input.title, input.meeting_type, input.meeting_date, input.start_time, input.end_time,
          input.meeting_mode, input.location_or_link, input.purpose, input.agenda, input.internal_notes, by],
      );
      const id = rows[0].id as string;
      for (const name of input.attendees as string[]) {
        await c.query(`INSERT INTO meeting_attendees (meeting_id, salon_id, name, kind) VALUES ($1,$2,$3,'invited')`, [id, input.salon_id, name]);
      }
      await audit(c, input.salon_id, "meeting", id, "meeting_created", null, { title: input.title, meeting_type: input.meeting_type, meeting_date: input.meeting_date, start_time: input.start_time }, by);
      return id;
    });
  },

  /** Edit / reschedule / cancel / mark not conducted. Completed meetings are history and cannot be changed here. */
  async updateMeeting(id: string, patch: Record<string, any>, by: string) {
    return tx(async (c) => {
      const { rows: cur } = await c.query(`SELECT ${MEETING_SELECT} WHERE m.id = $1 FOR UPDATE OF m`, [id]);
      const before = cur[0];
      if (!before) return { error: "NOT_FOUND" as const };
      if (before.status === "completed") return { error: "COMPLETED" as const };

      const fields = ["developer_id", "title", "meeting_type", "meeting_date", "start_time", "end_time", "meeting_mode", "location_or_link", "purpose", "agenda", "internal_notes", "status"];
      const after: Record<string, any> = { ...before };
      for (const k of fields) if (k in patch) after[k] = patch[k];
      const timeMoved = ["meeting_date", "start_time", "end_time"].some((k) => k in patch && (patch[k] ?? null) !== (before[k] ?? null));
      if (timeMoved && after.status === before.status && (before.status === "scheduled" || before.status === "rescheduled")) after.status = "rescheduled";

      const d = diff(before, after, fields);
      if (!d.changed && !("attendees" in patch)) return { id };

      await c.query(
        `UPDATE client_meetings SET developer_id=$2, title=$3, meeting_type=$4, meeting_date=$5, start_time=$6, end_time=$7, meeting_mode=$8,
           location_or_link=$9, purpose=$10, agenda=$11, internal_notes=$12, status=$13, updated_by=$14, updated_at=NOW() WHERE id=$1`,
        [id, after.developer_id, after.title, after.meeting_type, after.meeting_date, after.start_time, after.end_time, after.meeting_mode,
          after.location_or_link, after.purpose, after.agenda, after.internal_notes, after.status, by],
      );
      if (Array.isArray(patch.attendees)) {
        await c.query(`DELETE FROM meeting_attendees WHERE meeting_id = $1 AND kind = 'invited'`, [id]);
        for (const name of patch.attendees as string[]) {
          await c.query(`INSERT INTO meeting_attendees (meeting_id, salon_id, name, kind) VALUES ($1,$2,$3,'invited')`, [id, before.salon_id, name]);
        }
      }
      const action = timeMoved ? "meeting_rescheduled" : after.status !== before.status ? `meeting_${after.status}` : "meeting_updated";
      await audit(c, before.salon_id, "meeting", id, action, d.previous, d.next, by);
      return { id };
    });
  },

  /** Marks the meeting completed with its completion details, and writes the matching Activity History entry. */
  async completeMeeting(id: string, input: any, by: string) {
    return tx(async (c) => {
      const { rows: cur } = await c.query(`SELECT ${MEETING_SELECT} WHERE m.id = $1 FOR UPDATE OF m`, [id]);
      const before = cur[0];
      if (!before) return { error: "NOT_FOUND" as const };
      if (before.status === "completed") return { error: "ALREADY_COMPLETED" as const };
      if (before.status === "cancelled") return { error: "CANCELLED" as const };

      await c.query(
        `UPDATE client_meetings SET status='completed', actual_date=$2, actual_start_time=$3, actual_end_time=$4, discussion_summary=$5,
           training_provided=$6, work_completed=$7, client_feedback=$8, issues_discussed=$9, pending_actions=$10, next_followup_date=$11,
           completed_at=NOW(), completed_by=$12, updated_by=$12, updated_at=NOW() WHERE id=$1`,
        [id, input.actual_date, input.actual_start_time, input.actual_end_time, input.discussion_summary, input.training_provided,
          input.work_completed, input.client_feedback, input.issues_discussed, input.pending_actions, input.next_followup_date, by],
      );
      await c.query(`DELETE FROM meeting_attendees WHERE meeting_id = $1 AND kind = 'present'`, [id]);
      for (const name of input.attendees_present as string[]) {
        await c.query(`INSERT INTO meeting_attendees (meeting_id, salon_id, name, kind) VALUES ($1,$2,$3,'present')`, [id, before.salon_id, name]);
      }
      await c.query(
        `INSERT INTO client_activity_logs (salon_id, developer_id, activity_type, activity_date, description, work_completed, pending_work, next_followup, source_type, source_id, created_by, updated_by)
         VALUES ($1,$2,'meeting', ($3::date + COALESCE($4::time, TIME '00:00')), $5,$6,$7,$8,'meeting',$9,$10,$10)
         ON CONFLICT (source_type, source_id) WHERE source_id IS NOT NULL DO UPDATE SET description = EXCLUDED.description, work_completed = EXCLUDED.work_completed,
           pending_work = EXCLUDED.pending_work, next_followup = EXCLUDED.next_followup, updated_at = NOW()`,
        [before.salon_id, before.developer_id, input.actual_date, input.actual_start_time, `${before.title}: ${input.discussion_summary}`,
          input.work_completed, input.pending_actions, input.next_followup_date, id, by],
      );
      await audit(c, before.salon_id, "meeting", id, "meeting_completed",
        { status: before.status }, { status: "completed", actual_date: input.actual_date, actual_start_time: input.actual_start_time, actual_end_time: input.actual_end_time }, by);
      // A next follow-up date turns into a real follow-up task on the salon, so it shows with the salon's other follow-ups.
      if (input.next_followup_date) {
        const { rows: t } = await c.query(
          `INSERT INTO client_followup_tasks (salon_id, developer_id, title, description, priority, due_date, created_by, updated_by)
           VALUES ($1,$2,$3,$4,'medium',$5,$6,$6) RETURNING id`,
          [before.salon_id, before.developer_id, `Follow-up: ${before.title}`.slice(0, 200), input.pending_actions, input.next_followup_date, by],
        );
        await audit(c, before.salon_id, "task", t[0].id, "followup_created", null, { title: `Follow-up: ${before.title}`, due_date: input.next_followup_date, from_meeting: id }, by);
      }
      return { id };
    });
  },

  // ── Training ────────────────────────────────────────────────────────────────
  async listModules(includeInactive = false) {
    const { rows } = await pool.query(
      `SELECT id, name, is_default, is_active, sort_order FROM client_training_modules ${includeInactive ? "" : "WHERE is_active"} ORDER BY sort_order, name`,
    );
    return rows;
  },
  async createModule(name: string, by: string) {
    const { rows } = await pool.query(
      `INSERT INTO client_training_modules (name, is_default, sort_order, created_by)
       VALUES ($1, false, COALESCE((SELECT MAX(sort_order) FROM client_training_modules), 0) + 1, $2)
       ON CONFLICT (name) DO NOTHING RETURNING id, name, is_default, is_active, sort_order`,
      [name, by],
    );
    return rows[0] ?? null;
  },

  /** Every active module for one salon, with its progress (modules never touched read as not_started). */
  async salonTraining(salonId: string, f: { status?: string; developerId?: string }) {
    const x = q();
    x.params.push(salonId);
    const extra: string[] = [];
    if (f.status === "not_started") extra.push(`(p.id IS NULL OR p.status = 'not_started')`);
    else if (f.status) { x.params.push(f.status); extra.push(`p.status = $${x.params.length}`); }
    if (f.developerId) { x.params.push(f.developerId); extra.push(`p.developer_id = $${x.params.length}`); }
    const { rows } = await pool.query(
      `SELECT m.id AS module_id, m.name AS module_name, m.is_default, p.id AS progress_id, COALESCE(p.status, 'not_started') AS status,
              p.developer_id, d.name AS developer_name, p.training_date::text AS training_date, p.notes, p.attending_staff, p.duration_minutes,
              p.client_understanding, p.client_feedback, p.next_training_date::text AS next_training_date, p.completed_at, p.updated_at,
              (SELECT COUNT(*)::int FROM client_activity_attachments x WHERE x.entity_type='training' AND x.entity_id = p.id) AS attachment_count
         FROM client_training_modules m
         LEFT JOIN client_training_progress p ON p.module_id = m.id AND p.salon_id = $1
         LEFT JOIN developers d ON d.id = p.developer_id
        WHERE m.is_active ${extra.length ? "AND " + extra.join(" AND ") : ""}
        ORDER BY m.sort_order, m.name`,
      x.params,
    );
    return rows;
  },

  /** Salon-by-salon completion overview for the Training page. */
  async trainingOverview(f: { search?: string } & Page) {
    const x = q();
    if (f.search) add(x, (i) => `(${SALON_NAME} ILIKE $${i} OR s.id::text ILIKE $${i})`, `%${f.search}%`);
    const w = whereSql(x);
    const countParams = [...x.params];
    const lim = paging(x, f);
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(
        `WITH mods AS (SELECT COUNT(*)::int AS n FROM client_training_modules WHERE is_active)
         SELECT s.id AS salon_id, ${SALON_NAME} AS salon_name, (SELECT n FROM mods) AS total_modules,
                COUNT(p.id) FILTER (WHERE p.status = 'completed' AND m.is_active)::int AS completed,
                COUNT(p.id) FILTER (WHERE p.status IN ('scheduled','in_progress') AND m.is_active)::int AS in_pipeline,
                COUNT(p.id) FILTER (WHERE p.status = 'needs_retraining' AND m.is_active)::int AS needs_retraining,
                MAX(p.updated_at) AS last_updated
           FROM salons s
           LEFT JOIN client_training_progress p ON p.salon_id = s.id
           LEFT JOIN client_training_modules m ON m.id = p.module_id
           ${w}
          GROUP BY s.id ORDER BY MAX(p.updated_at) DESC NULLS LAST, ${SALON_NAME} ${lim}`,
        x.params,
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM salons s ${w}`, countParams),
    ]);
    return { items: rows, total: c[0].n as number };
  },

  async upsertTraining(input: any, by: string) {
    return tx(async (c) => {
      const { rows: cur } = await c.query(
        `SELECT id, developer_id, training_date::text AS training_date, status, notes, attending_staff, duration_minutes, client_understanding,
                client_feedback, next_training_date::text AS next_training_date
           FROM client_training_progress WHERE salon_id = $1 AND module_id = $2 FOR UPDATE`,
        [input.salon_id, input.module_id],
      );
      const before = cur[0];
      const keys = ["developer_id", "training_date", "status", "notes", "attending_staff", "duration_minutes", "client_understanding", "client_feedback", "next_training_date"];
      const { rows } = await c.query(
        `INSERT INTO client_training_progress (salon_id, module_id, developer_id, training_date, status, notes, attending_staff, duration_minutes,
           client_understanding, client_feedback, next_training_date, completed_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $13::boolean THEN NOW() END, $12, $12)
         ON CONFLICT (salon_id, module_id) DO UPDATE SET developer_id = EXCLUDED.developer_id, training_date = EXCLUDED.training_date,
           status = EXCLUDED.status, notes = EXCLUDED.notes, attending_staff = EXCLUDED.attending_staff, duration_minutes = EXCLUDED.duration_minutes,
           client_understanding = EXCLUDED.client_understanding, client_feedback = EXCLUDED.client_feedback, next_training_date = EXCLUDED.next_training_date,
           completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN COALESCE(client_training_progress.completed_at, NOW()) ELSE NULL END,
           updated_by = $12, updated_at = NOW()
         RETURNING id`,
        [input.salon_id, input.module_id, input.developer_id, input.training_date, input.status, input.notes, input.attending_staff,
          input.duration_minutes, input.client_understanding, input.client_feedback, input.next_training_date, by, input.status === "completed"],
      );
      const id = rows[0].id as string;
      const d = diff(before ?? {}, input, keys);
      if (!before || d.changed) {
        await audit(c, input.salon_id, "training", id, !before ? "training_created" : before.status !== input.status ? "training_status_updated" : "training_updated", before ? d.previous : null, before ? d.next : { status: input.status }, by);
      }
      if (input.status === "completed" && (!before || before.status !== "completed")) {
        const { rows: mod } = await c.query(`SELECT name FROM client_training_modules WHERE id = $1`, [input.module_id]);
        await c.query(
          `INSERT INTO client_activity_logs (salon_id, developer_id, activity_type, activity_date, description, work_completed, next_followup, source_type, source_id, created_by, updated_by)
           VALUES ($1,$2,'training', COALESCE($3::date, CURRENT_DATE), $4, $5, $6, 'training', $7, $8, $8)
           ON CONFLICT (source_type, source_id) WHERE source_id IS NOT NULL DO UPDATE SET activity_date = EXCLUDED.activity_date, description = EXCLUDED.description, updated_at = NOW()`,
          [input.salon_id, input.developer_id, input.training_date, `Training completed: ${mod[0]?.name ?? "module"}`, input.notes, input.next_training_date, id, by],
        );
      }
      return { id, created: !before };
    });
  },

  // ── Activity timeline ───────────────────────────────────────────────────────
  async listActivities(f: { salonId?: string[]; type?: string[]; developerId?: string[]; from?: string; to?: string; search?: string } & Page) {
    const x = q();
    if (f.salonId?.length) add(x, (i) => `a.salon_id::text = ANY($${i}::text[])`, f.salonId);
    if (f.type?.length) add(x, (i) => `a.activity_type = ANY($${i}::text[])`, f.type);
    if (f.developerId?.length) add(x, (i) => `a.developer_id::text = ANY($${i}::text[])`, f.developerId);
    if (f.from) add(x, (i) => `a.activity_date >= $${i}::date`, f.from);
    if (f.to) add(x, (i) => `a.activity_date < ($${i}::date + 1)`, f.to);
    if (f.search) add(x, (i) => `(a.description ILIKE $${i} OR ${SALON_NAME} ILIKE $${i})`, `%${f.search}%`);
    const w = whereSql(x);
    const countParams = [...x.params];
    const lim = paging(x, f);
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(`SELECT ${ACTIVITY_SELECT} ${w} ORDER BY a.activity_date DESC, a.created_at DESC ${lim}`, x.params),
      pool.query(`SELECT COUNT(*)::int AS n FROM client_activity_logs a JOIN salons s ON s.id = a.salon_id ${w}`, countParams),
    ]);
    return { items: rows, total: c[0].n as number };
  },
  async createActivity(input: any, by: string) {
    return tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO client_activity_logs (salon_id, developer_id, activity_type, activity_date, description, work_completed, pending_work, next_followup, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
        [input.salon_id, input.developer_id, input.activity_type, input.activity_date, input.description, input.work_completed, input.pending_work, input.next_followup, by],
      );
      await audit(c, input.salon_id, "activity", rows[0].id, "activity_created", null, { activity_type: input.activity_type, description: input.description }, by);
      return rows[0].id as string;
    });
  },
  async updateActivity(id: string, patch: Record<string, any>, by: string) {
    return tx(async (c) => {
      const { rows: cur } = await c.query(
        `SELECT id, salon_id, developer_id, activity_type, activity_date, description, work_completed, pending_work, next_followup::text AS next_followup, source_type
           FROM client_activity_logs WHERE id = $1 FOR UPDATE`, [id]);
      const before = cur[0];
      if (!before) return { error: "NOT_FOUND" as const };
      const keys = ["developer_id", "activity_type", "activity_date", "description", "work_completed", "pending_work", "next_followup"];
      const after: Record<string, any> = { ...before };
      for (const k of keys) if (k in patch) after[k] = patch[k];
      const d = diff(before, after, keys);
      if (!d.changed) return { id };
      await c.query(
        `UPDATE client_activity_logs SET developer_id=$2, activity_type=$3, activity_date=$4, description=$5, work_completed=$6, pending_work=$7,
           next_followup=$8, updated_by=$9, updated_at=NOW() WHERE id=$1`,
        [id, after.developer_id, after.activity_type, after.activity_date, after.description, after.work_completed, after.pending_work, after.next_followup, by],
      );
      await audit(c, before.salon_id, "activity", id, "activity_updated", d.previous, d.next, by);
      return { id };
    });
  },

  // ── Follow-up tasks ─────────────────────────────────────────────────────────
  async listTasks(f: { salonId?: string[]; developerId?: string[]; status?: string[]; bucket?: string; priority?: string[]; search?: string } & Page) {
    const x = q();
    if (f.salonId?.length) add(x, (i) => `t.salon_id::text = ANY($${i}::text[])`, f.salonId);
    if (f.developerId?.length) add(x, (i) => `t.developer_id::text = ANY($${i}::text[])`, f.developerId);
    if (f.status?.length) add(x, (i) => `t.status = ANY($${i}::text[])`, f.status);
    if (f.priority?.length) add(x, (i) => `t.priority = ANY($${i}::text[])`, f.priority);
    if (f.bucket === "overdue") x.where.push(`t.status IN ('pending','in_progress') AND t.due_date < CURRENT_DATE`);
    if (f.bucket === "upcoming") x.where.push(`t.status IN ('pending','in_progress') AND (t.due_date IS NULL OR t.due_date >= CURRENT_DATE)`);
    if (f.search) add(x, (i) => `(t.title ILIKE $${i} OR ${SALON_NAME} ILIKE $${i})`, `%${f.search}%`);
    const w = whereSql(x);
    const countParams = [...x.params];
    const lim = paging(x, f);
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(`SELECT ${TASK_SELECT} ${w} ORDER BY (t.status IN ('completed','cancelled')), t.due_date ASC NULLS LAST, t.created_at DESC ${lim}`, x.params),
      pool.query(`SELECT COUNT(*)::int AS n FROM client_followup_tasks t JOIN salons s ON s.id = t.salon_id ${w}`, countParams),
    ]);
    return { items: rows, total: c[0].n as number };
  },
  async createTask(input: any, by: string) {
    return tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO client_followup_tasks (salon_id, developer_id, title, description, priority, due_date, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [input.salon_id, input.developer_id, input.title, input.description, input.priority, input.due_date, by],
      );
      await audit(c, input.salon_id, "task", rows[0].id, "followup_created", null, { title: input.title, due_date: input.due_date, priority: input.priority }, by);
      return rows[0].id as string;
    });
  },
  async updateTask(id: string, patch: Record<string, any>, by: string) {
    return tx(async (c) => {
      const { rows: cur } = await c.query(
        `SELECT id, salon_id, developer_id, title, description, priority, due_date::text AS due_date, status, completion_notes
           FROM client_followup_tasks WHERE id = $1 FOR UPDATE`, [id]);
      const before = cur[0];
      if (!before) return { error: "NOT_FOUND" as const };
      const keys = ["developer_id", "title", "description", "priority", "due_date", "status", "completion_notes"];
      const after: Record<string, any> = { ...before };
      for (const k of keys) if (k in patch) after[k] = patch[k];
      if (after.status === "completed" && !String(after.completion_notes ?? "").trim()) return { error: "NOTES_REQUIRED" as const };
      const d = diff(before, after, keys);
      if (!d.changed) return { id };
      await c.query(
        `UPDATE client_followup_tasks SET developer_id=$2, title=$3, description=$4, priority=$5, due_date=$6, status=$7, completion_notes=$8,
           completed_at = CASE WHEN $10::boolean THEN COALESCE(completed_at, NOW()) ELSE NULL END, updated_by=$9, updated_at=NOW() WHERE id=$1`,
        [id, after.developer_id, after.title, after.description, after.priority, after.due_date, after.status, after.completion_notes, by, after.status === "completed"],
      );
      await audit(c, before.salon_id, "task", id, after.status === "completed" && before.status !== "completed" ? "followup_completed" : "followup_updated", d.previous, d.next, by);
      return { id };
    });
  },

  // ── Attachments & audit ─────────────────────────────────────────────────────
  async entitySalon(entityType: string, entityId: string): Promise<string | null> {
    const table = { meeting: "client_meetings", training: "client_training_progress", activity: "client_activity_logs", task: "client_followup_tasks" }[entityType];
    if (!table) return null;
    const { rows } = await pool.query(`SELECT salon_id FROM ${table} WHERE id = $1`, [entityId]);
    return rows[0]?.salon_id ?? null;
  },
  async addAttachment(a: { salon_id: string; entity_type: string; entity_id: string; file_name: string; file_url: string; mime_type: string | null; size_bytes: number }, by: string) {
    return tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO client_activity_attachments (salon_id, entity_type, entity_id, file_name, file_url, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, file_name, file_url, mime_type, size_bytes, created_at`,
        [a.salon_id, a.entity_type, a.entity_id, a.file_name, a.file_url, a.mime_type, a.size_bytes, by],
      );
      await audit(c, a.salon_id, a.entity_type, a.entity_id, "attachment_uploaded", null, { file_name: a.file_name }, by);
      return rows[0];
    });
  },
  async listAttachments(entityType: string, entityId: string) {
    const { rows } = await pool.query(
      `SELECT id, file_name, file_url, mime_type, size_bytes, created_at FROM client_activity_attachments WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
      [entityType, entityId],
    );
    return rows;
  },
  async listAudit(f: { salonId?: string; entityType?: string; entityId?: string } & Page) {
    const x = q();
    if (f.salonId) add(x, (i) => `l.salon_id = $${i}`, f.salonId);
    if (f.entityType) add(x, (i) => `l.entity_type = $${i}`, f.entityType);
    if (f.entityId) add(x, (i) => `l.entity_id = $${i}`, f.entityId);
    const w = whereSql(x);
    const lim = paging(x, f);
    const { rows } = await pool.query(
      `SELECT l.id, l.salon_id, l.entity_type, l.entity_id, l.action, l.previous_values, l.new_values, l.changed_at,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS changed_by_name
         FROM client_activity_audit_logs l LEFT JOIN users u ON u.id = l.changed_by ${w} ORDER BY l.changed_at DESC ${lim}`,
      x.params,
    );
    return rows;
  },

  // ── Dashboard, salon summary, reports ──────────────────────────────────────
  async dashboard() {
    const [kpi, today, upcoming, recent, pendingTraining, overdue] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM client_meetings WHERE status IN ('scheduled','rescheduled')) AS scheduled_meetings,
           (SELECT COUNT(*)::int FROM client_meetings WHERE status = 'completed') AS completed_meetings,
           (SELECT COUNT(*)::int FROM client_meetings WHERE status IN ('scheduled','rescheduled') AND meeting_date >= CURRENT_DATE) AS upcoming_meetings,
           (SELECT COUNT(*)::int FROM client_training_progress WHERE status <> 'completed') AS pending_training,
           (SELECT COUNT(*)::int FROM client_training_progress WHERE status = 'completed') AS completed_training,
           (SELECT COUNT(*)::int FROM client_followup_tasks WHERE status IN ('pending','in_progress') AND due_date < CURRENT_DATE) AS overdue_followups`,
      ),
      pool.query(`SELECT ${MEETING_SELECT} WHERE m.meeting_date = CURRENT_DATE AND m.status IN ('scheduled','rescheduled','completed') ORDER BY m.start_time NULLS LAST LIMIT 20`),
      pool.query(`SELECT ${MEETING_SELECT} WHERE m.meeting_date > CURRENT_DATE AND m.status IN ('scheduled','rescheduled') ORDER BY m.meeting_date, m.start_time NULLS LAST LIMIT 10`),
      pool.query(`SELECT ${ACTIVITY_SELECT} ORDER BY a.activity_date DESC, a.created_at DESC LIMIT 10`),
      pool.query(
        `SELECT p.id, p.salon_id, ${SALON_NAME} AS salon_name, m.name AS module_name, p.status, p.training_date::text AS training_date, d.name AS developer_name
           FROM client_training_progress p JOIN salons s ON s.id = p.salon_id JOIN client_training_modules m ON m.id = p.module_id
           LEFT JOIN developers d ON d.id = p.developer_id
          WHERE p.status <> 'completed' ORDER BY p.training_date NULLS LAST, p.updated_at DESC LIMIT 10`),
      pool.query(`SELECT ${TASK_SELECT} WHERE t.status IN ('pending','in_progress') AND t.due_date < CURRENT_DATE ORDER BY t.due_date LIMIT 10`),
    ]);
    return { kpis: kpi.rows[0], today_meetings: today.rows, upcoming_meetings: upcoming.rows, recent_activities: recent.rows, pending_training: pendingTraining.rows, overdue_tasks: overdue.rows };
  },

  async salonSummary(salonId: string) {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM client_meetings WHERE salon_id = $1) AS total_meetings,
         (SELECT COUNT(*)::int FROM client_meetings WHERE salon_id = $1 AND status = 'completed') AS completed_meetings,
         (SELECT COUNT(*)::int FROM client_meetings WHERE salon_id = $1 AND status IN ('scheduled','rescheduled') AND meeting_date >= CURRENT_DATE) AS upcoming_meetings,
         (SELECT COUNT(*)::int FROM client_training_progress p JOIN client_training_modules m ON m.id = p.module_id WHERE p.salon_id = $1 AND p.status = 'completed' AND m.is_active) AS completed_training,
         (SELECT COUNT(*)::int FROM client_training_modules WHERE is_active) AS total_modules,
         (SELECT COUNT(*)::int FROM client_followup_tasks WHERE salon_id = $1 AND status IN ('pending','in_progress')) AS pending_followups,
         (SELECT COUNT(*)::int FROM client_followup_tasks WHERE salon_id = $1 AND status IN ('pending','in_progress') AND due_date < CURRENT_DATE) AS overdue_followups`,
      [salonId],
    );
    const { rows: last } = await pool.query(`SELECT ${ACTIVITY_SELECT} WHERE a.salon_id = $1 ORDER BY a.activity_date DESC, a.created_at DESC LIMIT 1`, [salonId]);
    const s = rows[0];
    return { ...s, pending_training: Math.max(0, s.total_modules - s.completed_training), latest_activity: last[0] ?? null };
  },

  async reports(f: { salonId?: string; from?: string; to?: string; search?: string } & Page) {
    const x = q();
    if (f.salonId) add(x, (i) => `s.id = $${i}`, f.salonId);
    if (f.search) add(x, (i) => `${SALON_NAME} ILIKE $${i}`, `%${f.search}%`);
    const w = whereSql(x);
    const fromP = (x.params.push(f.from ?? null), x.params.length);
    const toP = (x.params.push(f.to ?? null), x.params.length);
    const countParams = x.params.slice(0, x.params.length - 2);
    const lim = paging(x, f);
    const inRange = (col: string) => `($${fromP}::date IS NULL OR ${col} >= $${fromP}::date) AND ($${toP}::date IS NULL OR ${col} <= $${toP}::date)`;
    const [{ rows }, { rows: c }] = await Promise.all([
      pool.query(
        `SELECT s.id AS salon_id, ${SALON_NAME} AS salon_name,
           (SELECT COUNT(*)::int FROM client_meetings m WHERE m.salon_id = s.id AND ${inRange("m.meeting_date")}) AS meetings,
           (SELECT COUNT(*)::int FROM client_meetings m WHERE m.salon_id = s.id AND m.status = 'completed' AND ${inRange("m.meeting_date")}) AS completed_meetings,
           (SELECT COUNT(*)::int FROM client_meetings m WHERE m.salon_id = s.id AND m.status IN ('cancelled','not_conducted') AND ${inRange("m.meeting_date")}) AS missed_meetings,
           (SELECT COUNT(*)::int FROM client_training_progress p JOIN client_training_modules mo ON mo.id = p.module_id WHERE p.salon_id = s.id AND p.status = 'completed' AND mo.is_active) AS training_completed,
           (SELECT COUNT(*)::int FROM client_training_modules WHERE is_active) AS training_total,
           (SELECT COUNT(*)::int FROM client_training_progress p WHERE p.salon_id = s.id AND p.client_understanding = 'needs_more_training') AS needs_more_training,
           (SELECT COUNT(*)::int FROM client_followup_tasks t WHERE t.salon_id = s.id AND t.status IN ('pending','in_progress')) AS open_followups,
           (SELECT COUNT(*)::int FROM client_followup_tasks t WHERE t.salon_id = s.id AND t.status IN ('pending','in_progress') AND t.due_date < CURRENT_DATE) AS overdue_followups,
           (SELECT COUNT(*)::int FROM client_activity_logs a WHERE a.salon_id = s.id AND ${inRange("a.activity_date::date")}) AS activities,
           (SELECT MAX(a.activity_date) FROM client_activity_logs a WHERE a.salon_id = s.id) AS last_activity_at
         FROM salons s ${w} ORDER BY last_activity_at DESC NULLS LAST, salon_name ${lim}`,
        x.params,
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM salons s ${w}`, countParams),
    ]);
    let breakdown = null;
    if (f.salonId) {
      const [byType, byStatus, byUnderstanding] = await Promise.all([
        pool.query(`SELECT meeting_type AS key, COUNT(*)::int AS n FROM client_meetings WHERE salon_id = $1 GROUP BY 1`, [f.salonId]),
        pool.query(`SELECT status AS key, COUNT(*)::int AS n FROM client_meetings WHERE salon_id = $1 GROUP BY 1`, [f.salonId]),
        pool.query(`SELECT COALESCE(client_understanding, 'not_recorded') AS key, COUNT(*)::int AS n FROM client_training_progress WHERE salon_id = $1 GROUP BY 1`, [f.salonId]),
      ]);
      breakdown = { meetings_by_type: byType.rows, meetings_by_status: byStatus.rows, understanding: byUnderstanding.rows };
    }
    return { items: rows, total: c[0].n as number, breakdown };
  },
};
