import pool from "../../config/database";

export interface Notification {
  id: string;
  salon_id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
  product_id?: string | null;
  branch_id?: string | null;
  alert_status?: string | null;
  resolved_at?: string | null;
}

export const notificationsRepository = {
  async create(data: {
    salon_id: string;
    type: string;
    title: string;
    body?: string;
    product_id?: string;
    branch_id?: string;
    alert_status?: string;
  }) {
    const { rows } = await pool.query<Notification>(
      `INSERT INTO notifications (salon_id, type, title, body, product_id, branch_id, alert_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.salon_id, data.type, data.title, data.body ?? null,
        data.product_id ?? null, data.branch_id ?? null, data.alert_status ?? null,
      ]
    );
    return rows[0];
  },

  // Finds the still-active (unresolved) alert notification for this
  // product+status pair, if any — lets inventoryAlertsService decide
  // whether to skip (nothing changed), refresh in place (qty/expiry moved
  // but status is the same), or resolve it (condition cleared).
  async findActiveAlert(productId: string, alertStatus: string): Promise<Notification | null> {
    const { rows } = await pool.query<Notification>(
      `SELECT * FROM notifications
        WHERE product_id = $1 AND alert_status = $2 AND resolved_at IS NULL
        LIMIT 1`,
      [productId, alertStatus]
    );
    return rows[0] ?? null;
  },

  // Resolves every still-active alert for a product except the one(s) whose
  // status is passed in `keepStatuses` — e.g. once a product is back above
  // its threshold, its low_stock/out_of_stock alerts should close even
  // though no new alert is being raised this pass.
  async resolveActiveAlertsExcept(productId: string, keepStatuses: string[]): Promise<void> {
    await pool.query(
      `UPDATE notifications
          SET resolved_at = NOW()
        WHERE product_id = $1 AND resolved_at IS NULL
          AND alert_status IS NOT NULL
          AND NOT (alert_status = ANY($2::text[]))`,
      [productId, keepStatuses]
    );
  },

  async touchAlert(id: string, data: { title: string; body: string | null }): Promise<Notification> {
    const { rows } = await pool.query<Notification>(
      `UPDATE notifications SET title = $1, body = $2 WHERE id = $3 RETURNING *`,
      [data.title, data.body, id]
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
