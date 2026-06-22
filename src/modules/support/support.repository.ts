import pool, { safeQuery } from "../../config/database";

export const supportRepo = {
  async createTicket(data: {
    salon_id: string;
    user_id: string;
    subject: string;
    category: string;
    message: string;
    priority: string;
  }) {
    const { rows } = await safeQuery(() =>
      pool.query(
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
    return rows;
  },

  async getAllTickets(filters: { status?: string; priority?: string; search?: string } = {}) {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.status) { conditions.push(`t.status = $${idx++}`); values.push(filters.status); }
    if (filters.priority) { conditions.push(`t.priority = $${idx++}`); values.push(filters.priority); }
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
                COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
         FROM support_tickets t
         LEFT JOIN users  u ON u.id = t.user_id
         LEFT JOIN salons s ON s.id = t.salon_id
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
         SET admin_reply=$2, replied_at=NOW(), status='in_progress', updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, reply]
      )
    );
    return rows[0];
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
    return rows[0];
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
           COUNT(*) FILTER (WHERE priority='high')        AS high_priority
         FROM support_tickets`
      )
    );
    return rows[0];
  },
};
