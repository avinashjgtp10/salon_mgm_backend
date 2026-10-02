import pool, { safeQuery } from "../../config/database";
import type {
  ClientRequirementRow,
  CreateRequirementInput,
  ListRequirementsFilters,
  RequirementAssignee,
  RequirementStatus,
  RequirementUpdateRow,
  UpdateType,
} from "./client-requirements.types";

// user_id is nullable — requirements are created by Super Admin on the
// salon's behalf with no submitting user, so submitter_name/email fall back
// to the salon's own owner (via salons.owner_id) whenever r.user_id is null.
// assignee_name/email (legacy single-assignee columns) now join the plain
// developers table, not users — a "developer" is just a name+email contact
// record, never a login-capable platform account.
const SELECT_WITH_JOINS = `
  SELECT r.*,
         COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
         COALESCE(
           NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), ''),
           NULLIF(TRIM(CONCAT(o.first_name, ' ', COALESCE(o.last_name, ''))), '')
         ) AS submitter_name,
         COALESCE(u.email, s.email, o.email) AS submitter_email,
         a.name AS assignee_name,
         a.email AS assignee_email
  FROM client_requirements r
  LEFT JOIN salons s ON s.id = r.salon_id
  LEFT JOIN users  u ON u.id = r.user_id
  LEFT JOIN users  o ON o.id = s.owner_id
  LEFT JOIN developers a ON a.id = r.assigned_to
`;

export const clientRequirementsRepository = {
  // Developers to assign a requirement to — plain name+email contact
  // records (developers table), NOT login-capable platform accounts. A
  // developer only ever receives assignment/status-change emails; they
  // never authenticate or access the app.
  async listDevelopers(): Promise<{ id: string; name: string; email: string }[]> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT id, name, email FROM developers WHERE is_active = true ORDER BY name ASC`
      )
    );
    return rows;
  },

  // "Manage Team" — creates a plain developer contact record. No password,
  // no `users` row, no platform access of any kind.
  async createDeveloper(data: { name: string; email: string; phone?: string; createdBy?: string | null }) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `INSERT INTO developers (name, email, phone, created_by)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, email, phone, is_active, created_at`,
        [data.name, data.email.toLowerCase().trim(), data.phone ?? null, data.createdBy ?? null]
      )
    );
    return rows[0];
  },

  async listAllDevelopers(): Promise<{ id: string; name: string; email: string; phone: string | null; is_active: boolean; created_at: string }[]> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT id, name, email, phone, is_active, created_at FROM developers ORDER BY created_at DESC`
      )
    );
    return rows;
  },

  async setDeveloperStatus(id: string, isActive: boolean) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE developers SET is_active = $2, updated_at = NOW() WHERE id = $1 RETURNING id, is_active`,
        [id, isActive]
      )
    );
    return rows[0] ?? null;
  },


  // Creates the requirement AND its developer assignments in one
  // transaction — assignment now happens at creation time (per spec) rather
  // than as a separate later step, so a failure partway through never
  // leaves a requirement with no developers when some were actually
  // intended. Falls back to the legacy single `assigned_to` column set to
  // the first developer in the list, for the older assign()/status-email
  // code paths that still read it.
  async create(data: CreateRequirementInput): Promise<ClientRequirementRow> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: seqRows } = await client.query(`SELECT nextval('client_requirement_req_no_seq') AS n`);
      const reqNumber = Number(seqRows[0].n);

      const firstDeveloperId = data.developers?.[0]?.developer_id ?? null;
      const { rows } = await client.query(
        `INSERT INTO client_requirements (req_number, salon_id, user_id, title, description, priority, status, assigned_to, target_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          reqNumber, data.salon_id, data.user_id ?? null, data.title, data.description, data.priority,
          data.status ?? "open", firstDeveloperId, data.target_date ?? null,
        ]
      );
      const requirement = rows[0];

      for (const dev of data.developers ?? []) {
        await client.query(
          `INSERT INTO client_requirement_assignees (requirement_id, developer_id, role_label)
           VALUES ($1,$2,$3)
           ON CONFLICT (requirement_id, developer_id) DO NOTHING`,
          [requirement.id, dev.developer_id, dev.role_label ?? null]
        );
      }

      await client.query("COMMIT");
      return requirement;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async listAssignees(requirementId: string): Promise<RequirementAssignee[]> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT cra.id, cra.developer_id, cra.role_label,
                d.name AS developer_name,
                d.email AS developer_email
         FROM client_requirement_assignees cra
         JOIN developers d ON d.id = cra.developer_id
         WHERE cra.requirement_id = $1
         ORDER BY cra.created_at ASC`,
        [requirementId]
      )
    );
    return rows;
  },

  async findById(id: string): Promise<ClientRequirementRow | null> {
    const { rows } = await safeQuery(() => pool.query(`${SELECT_WITH_JOINS} WHERE r.id = $1`, [id]));
    if (!rows[0]) return null;
    const assignees = await clientRequirementsRepository.listAssignees(id);
    return { ...rows[0], assignees };
  },

  async findAll(filters: ListRequirementsFilters): Promise<ClientRequirementRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.status) { conditions.push(`r.status = $${idx++}`); values.push(filters.status); }
    if (filters.priority) { conditions.push(`r.priority = $${idx++}`); values.push(filters.priority); }
    if (filters.search) {
      conditions.push(`(
        r.title ILIKE $${idx}
        OR CONCAT('REQ-', LPAD(r.req_number::text, 3, '0')) ILIKE $${idx}
        OR COALESCE(s.business_name, s.slug, '') ILIKE $${idx}
      )`);
      values.push(`%${filters.search}%`);
      idx++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await safeQuery(() =>
      pool.query(
        `${SELECT_WITH_JOINS} ${where}
         ORDER BY CASE r.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, r.created_at DESC`,
        values
      )
    );
    if (rows.length === 0) return rows;

    // Batch-fetch assignees for every row in the list in one query instead
    // of N+1 round trips per requirement.
    const { rows: allAssignees } = await pool.query(
      `SELECT cra.requirement_id, cra.id, cra.developer_id, cra.role_label,
              d.name AS developer_name,
              d.email AS developer_email
       FROM client_requirement_assignees cra
       JOIN developers d ON d.id = cra.developer_id
       WHERE cra.requirement_id = ANY($1::uuid[])
       ORDER BY cra.created_at ASC`,
      [rows.map((r) => r.id)]
    );
    const byRequirement = new Map<string, RequirementAssignee[]>();
    for (const a of allAssignees) {
      const list = byRequirement.get(a.requirement_id) ?? [];
      list.push(a);
      byRequirement.set(a.requirement_id, list);
    }
    return rows.map((r) => ({ ...r, assignees: byRequirement.get(r.id) ?? [] }));
  },

  async updateStatus(id: string, status: RequirementStatus): Promise<ClientRequirementRow | null> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE client_requirements
         SET status = $2, updated_at = NOW(), completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END
         WHERE id = $1
         RETURNING *`,
        [id, status]
      )
    );
    return rows[0] ?? null;
  },

  async assign(id: string, assigneeId: string | null, targetDate: string | null): Promise<ClientRequirementRow | null> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE client_requirements SET assigned_to = $2, target_date = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, assigneeId, targetDate]
      )
    );
    return rows[0] ?? null;
  },

  async addUpdate(data: {
    requirement_id: string;
    author_id: string | null;
    update_type: UpdateType;
    message: string;
    old_status?: RequirementStatus | null;
    new_status?: RequirementStatus | null;
    emailed: boolean;
  }): Promise<RequirementUpdateRow> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `INSERT INTO client_requirement_updates
           (requirement_id, author_id, update_type, message, old_status, new_status, emailed_at)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7 THEN NOW() ELSE NULL END)
         RETURNING *`,
        [
          data.requirement_id, data.author_id, data.update_type, data.message,
          data.old_status ?? null, data.new_status ?? null, data.emailed,
        ]
      )
    );
    return rows[0];
  },

  async listUpdates(requirementId: string): Promise<RequirementUpdateRow[]> {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT ru.*, NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS author_name
         FROM client_requirement_updates ru
         LEFT JOIN users u ON u.id = ru.author_id
         WHERE ru.requirement_id = $1
         ORDER BY ru.created_at ASC`,
        [requirementId]
      )
    );
    return rows;
  },

  async getStats() {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open,
           COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE priority = 'high')::int AS high_priority
         FROM client_requirements`
      )
    );
    return rows[0];
  },
};
