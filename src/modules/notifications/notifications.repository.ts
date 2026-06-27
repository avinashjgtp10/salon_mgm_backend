import pool from "../../config/database";

export interface Notification {
  id: string;
  salon_id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

export const notificationsRepository = {
  async create(data: { salon_id: string; type: string; title: string; body?: string }) {
    const { rows } = await pool.query<Notification>(
      `INSERT INTO notifications (salon_id, type, title, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.salon_id, data.type, data.title, data.body ?? null]
    );
    return rows[0];
  },

  async listBySalon(salonId: string, limit = 30): Promise<Notification[]> {
    const { rows } = await pool.query<Notification>(
      `SELECT * FROM notifications
       WHERE salon_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [salonId, limit]
    );
    return rows;
  },

  async markRead(id: string, salonId: string) {
    const { rows } = await pool.query<Notification>(
      `UPDATE notifications SET is_read = true
       WHERE id = $1 AND salon_id = $2
       RETURNING *`,
      [id, salonId]
    );
    return rows[0] ?? null;
  },

  async markAllRead(salonId: string) {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE salon_id = $1 AND is_read = false`,
      [salonId]
    );
  },

  async getUnreadCount(salonId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE salon_id = $1 AND is_read = false`,
      [salonId]
    );
    return parseInt(rows[0]?.count ?? "0", 10);
  },
};
