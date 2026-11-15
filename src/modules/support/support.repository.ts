import pool, { safeQuery } from "../../config/database";

// Columns added after the original table (callbacks, assignment, internal notes). They are added on first use, same as the
// invoice PDF column, so everything works even before Migration/add_support_ticket_callback.sql has been run. Plain ticket
// creation by a salon never touches this.
let callbackColumns: Promise<void> | null = null;
export function ensureSupportColumns(): Promise<void> {
  if (!callbackColumns) {
    callbackColumns = pool
      .query(
        `ALTER TABLE support_tickets
           ADD COLUMN IF NOT EXISTS callback_phone  TEXT,
           ADD COLUMN IF NOT EXISTS callback_slot   TEXT,
           ADD COLUMN IF NOT EXISTS callback_at     TIMESTAMPTZ,
           ADD COLUMN IF NOT EXISTS callback_module TEXT,
           ADD COLUMN IF NOT EXISTS assigned_to     UUID,
           ADD COLUMN IF NOT EXISTS assigned_at     TIMESTAMPTZ,
           ADD COLUMN IF NOT EXISTS internal_notes  JSONB NOT NULL DEFAULT '[]'::jsonb`
      )
      .then(() => undefined)
      .catch((err) => { callbackColumns = null; throw err; });   // try again next time if the database user can't alter tables yet
  }
  return callbackColumns;
}

/** Support-team-only fields: removed from anything returned to a salon. */
export function publicTicket<T extends Record<string, any> | null | undefined>(row: T): T {
  if (!row) return row;
  const { internal_notes, assigned_to, assigned_at, assigned_name, ...rest } = row as any;
  return rest as T;
}

export const supportRepo = {
  async createTicket(data: {
    salon_id: string;
    user_id: string;
    subject: string;
    category: string;
    message: string;
    priority: string;
    callback?: { phone: string; slot: string; at: Date; module: string | null };
  }) {
    // Callback columns are only written for a callback, so ordinary tickets don't depend on that migration.
    const cb = data.callback;
    if (cb) await ensureSupportColumns();
    const { rows } = await safeQuery(() =>
      cb
        ? pool.query(
            `INSERT INTO support_tickets
               (salon_id, user_id, subject, category, message, priority, status, callback_phone, callback_slot, callback_at, callback_module, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,NOW(),NOW())
             RETURNING *`,
            [data.salon_id, data.user_id, data.subject, data.category, data.message, data.priority, cb.phone, cb.slot, cb.at.toISOString(), cb.module]
          )
        : pool.query(
            `INSERT INTO support_tickets
               (salon_id, user_id, subject, category, message, priority, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,'open',NOW(),NOW())
             RETURNING *`,
            [data.salon_id, data.user_id, data.subject, data.category, data.message, data.priority]
          )
    );
    return rows[0];
  },

  async getTicketsByUser(userId: string, salonId: string) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT t.*,
                u.first_name || ' ' || COALESCE(u.last_name,'') AS submitter_name,
                COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
         FROM support_tickets t
         LEFT JOIN users  u ON u.id = t.user_id
         LEFT JOIN salons s ON s.id = t.salon_id
         WHERE t.user_id = $1 AND t.salon_id = $2
         ORDER BY t.created_at DESC`,
        [userId, salonId]
      )
    );
    return rows.map(publicTicket);
  },

  // Super admin edit of the ticket's own text fields. Status and the reply have their own endpoints.
  async updateTicketDetails(id: string, d: { subject: string; category: string; message: string; priority: string }) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE support_tickets
         SET subject=$2, category=$3, message=$4, priority=$5, updated_at=NOW()
         WHERE id=$1
         RETURNING id`,
        [id, d.subject, d.category, d.message, d.priority]
      )
    );
    return rows[0] ? (await supportRepo.getTicketById(id)) ?? rows[0] : null;
  },

  async deleteTicket(id: string): Promise<boolean> {
    const { rowCount } = await safeQuery(() => pool.query(`DELETE FROM support_tickets WHERE id=$1`, [id]));
    return (rowCount ?? 0) > 0;
  },

  async getAllTickets(filters: { id?: string; status?: string; priority?: string; search?: string; kind?: "ticket" | "callback" } = {}) {
    await ensureSupportColumns();
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.id) { conditions.push(`t.id = $${idx++}`); values.push(filters.id); }
    if (filters.status) { conditions.push(`t.status = $${idx++}`); values.push(filters.status); }
    if (filters.priority) { conditions.push(`t.priority = ${idx++}`); values.push(filters.priority); }
    if (filters.kind === "callback") conditions.push(`t.category = 'Callback'`);
    if (filters.kind === "ticket") conditions.push(`t.category IS DISTINCT FROM 'Callback'`);
    if (filters.search) {
      conditions.push(`(
        t.subject ILIKE $${idx}
        OR t.message ILIKE $${idx}
        OR COALESCE(s.business_name, s.slug, '') ILIKE $${idx}
      )`);
      values.push(`%${filters.search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT t.*,
                u.first_name || ' ' || COALESCE(u.last_name,'') AS submitter_name,
                u.email AS submitter_email,
                COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
                NULLIF(TRIM(CONCAT(a.first_name, ' ', COALESCE(a.last_name, ''))), '') AS assigned_name
         FROM support_tickets t
         LEFT JOIN users  u ON u.id = t.user_id
         LEFT JOIN salons s ON s.id = t.salon_id
         LEFT JOIN users  a ON a.id = t.assigned_to
         ${where}
         ORDER BY
           CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           t.created_at DESC`,
        values
      )
    );
    return rows;
  },

  async getTicketById(id: string) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT t.*,
                u.first_name || ' ' || COALESCE(u.last_name,'') AS submitter_name,
                u.email AS submitter_email,
                COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
         FROM support_tickets t
         LEFT JOIN users  u ON u.id = t.user_id
         LEFT JOIN salons s ON s.id = t.salon_id
         WHERE t.id = $1`,
        [id]
      )
    );
    return rows[0] ?? null;
  },

  async replyToTicket(id: string, reply: string) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE support_tickets
         SET reply_read_at = CASE WHEN admin_reply IS DISTINCT FROM $2 THEN NULL ELSE reply_read_at END,
             replied_at    = CASE WHEN admin_reply IS DISTINCT FROM $2 THEN NOW() ELSE replied_at END,
             admin_reply   = $2,
             status        = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
             updated_at    = NOW()
         WHERE id=$1
         RETURNING *`,
        [id, reply]
      )
    );
    // Re-read with the submitter/salon joins so the UI can swap the row in place
    // without losing salon_name / submitter_name / attachments.
    return rows[0] ? (await supportRepo.getTicketById(id)) ?? rows[0] : rows[0];
  },

  // Only the ticket's own submitter can mark its reply read — the WHERE on
  // user_id/salon_id keeps one user from touching another's tickets.
  async markReplyRead(id: string, userId: string, salonId: string) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE support_tickets
         SET reply_read_at = COALESCE(reply_read_at, NOW())
         WHERE id = $1 AND user_id = $2 AND salon_id = $3 AND admin_reply IS NOT NULL
         RETURNING *`,
        [id, userId, salonId]
      )
    );
    return publicTicket(rows[0]) ?? null;
  },

  async updateTicketStatus(id: string, status: string) {
    const { rows } = await safeQuery(() =>
      pool.query(
        `UPDATE support_tickets
         SET status=$2, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, status]
      )
    );
    // Re-read with the submitter/salon joins so the UI can swap the row in place
    // without losing salon_name / submitter_name / attachments.
    return rows[0] ? (await supportRepo.getTicketById(id)) ?? rows[0] : rows[0];
  },

  // Support-team assignment. Pass null to unassign.
  async assignTicket(id: string, assigneeId: string | null) {
    await ensureSupportColumns();
    const { rowCount } = await safeQuery(() =>
      pool.query(
        `UPDATE support_tickets SET assigned_to = $2, assigned_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE NOW() END, updated_at = NOW() WHERE id = $1`,
        [id, assigneeId]
      )
    );
    return (rowCount ?? 0) > 0;
  },

  // Internal notes are an append-only list on the ticket, visible to the support team only.
  async addInternalNote(id: string, note: { id: string; author_id: string; author_name: string; note: string; at: string }) {
    await ensureSupportColumns();
    const { rowCount } = await safeQuery(() =>
      pool.query(
        `UPDATE support_tickets SET internal_notes = COALESCE(internal_notes, '[]'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [id, JSON.stringify([note])]
      )
    );
    return (rowCount ?? 0) > 0;
  },

  // Super Admin accounts: who a ticket or callback can be assigned to.
  async listAssignees() {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT id, NULLIF(TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))), '') AS name, email
         FROM users WHERE role = 'super_admin' ORDER BY first_name, email`
      )
    );
    return rows.map((r: any) => ({ id: r.id, name: r.name || r.email, email: r.email }));
  },

  // The salon's owner: a ticket the support team raises for a salon belongs to its owner, so the owner sees it under My Requests.
  async getSalonOwner(salonId: string) {
    const { rows } = await safeQuery(() => pool.query(`SELECT owner_id FROM salons WHERE id = $1`, [salonId]));
    return (rows[0]?.owner_id as string | undefined) ?? null;
  },

  // Open callbacks that have a time to call back (the deadline sweeper reads these).
  async getOpenCallbacksWithTime() {
    await ensureSupportColumns();
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT t.id, t.category, t.subject, t.callback_phone, t.callback_at,
                COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
         FROM support_tickets t LEFT JOIN salons s ON s.id = t.salon_id
         WHERE t.category = 'Callback' AND t.status IN ('open', 'in_progress') AND t.callback_at IS NOT NULL`
      )
    );
    return rows;
  },

  async getStats() {
    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT
           COUNT(*)                                        AS total,
           COUNT(*) FILTER (WHERE status='open')          AS open,
           COUNT(*) FILTER (WHERE status='in_progress')   AS in_progress,
           COUNT(*) FILTER (WHERE status='resolved')      AS resolved,
           COUNT(*) FILTER (WHERE status='closed')        AS closed,
           COUNT(*) FILTER (WHERE priority='high' AND status IN ('open','in_progress')) AS high_priority
         FROM support_tickets`
      )
    );
    return rows[0];
  },
};
