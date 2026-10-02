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
  spotlight_feature_id?: string | null;
  reference_id?: string | null;
  recipient_user_ids?: string[];
  contact_phone?: string | null;
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
    spotlight_feature_id?: string;
    reference_id?: string;
    recipient_user_ids?: string[];
    contact_phone?: string;
  }) {
    const { rows } = await pool.query<Notification>(
      `INSERT INTO notifications (salon_id, type, title, body, product_id, branch_id, alert_status, spotlight_feature_id, reference_id, recipient_user_ids, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.salon_id, data.type, data.title, data.body ?? null,
        data.product_id ?? null, data.branch_id ?? null, data.alert_status ?? null, data.spotlight_feature_id ?? null, data.reference_id ?? null, data.recipient_user_ids ?? [],
        data.contact_phone ?? null,
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

  async listBySalon(salonId: string, limit = 30, staffUserId?: string): Promise<Notification[]> {
    if (staffUserId) {
      const { rows } = await pool.query<Notification>(
        `SELECT n.*, (r.user_id IS NOT NULL) AS is_read FROM notifications n
         LEFT JOIN notification_staff_reads r ON r.notification_id = n.id AND r.user_id = $3
         WHERE n.salon_id = $1 AND n.type = 'appointment' AND $3::uuid = ANY(n.recipient_user_ids)
         ORDER BY n.created_at DESC LIMIT $2`, [salonId, limit, staffUserId]);
      return rows;
    }
    const { rows } = await pool.query<Notification>(
      `SELECT * FROM notifications WHERE salon_id = $1 ORDER BY created_at DESC LIMIT $2`, [salonId, limit]);
    return rows;
  },

  async markRead(id: string, salonId: string, staffUserId?: string) {
    if (staffUserId) {
      const { rows } = await pool.query<Notification>(
        `WITH read_row AS (INSERT INTO notification_staff_reads (notification_id, user_id)
          SELECT id, $3 FROM notifications WHERE id = $1 AND salon_id = $2
          AND type = 'appointment' AND $3::uuid = ANY(recipient_user_ids)
          ON CONFLICT DO NOTHING)
         SELECT n.*, true AS is_read FROM notifications n WHERE n.id = $1 AND n.salon_id = $2
         AND n.type = 'appointment' AND $3::uuid = ANY(n.recipient_user_ids)`, [id, salonId, staffUserId]);
      return rows[0] ?? null;
    }
    const { rows } = await pool.query<Notification>(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND salon_id = $2 RETURNING *`, [id, salonId]);
    return rows[0] ?? null;
  },

  async markAllRead(salonId: string, staffUserId?: string) {
    if (staffUserId) {
      await pool.query(`INSERT INTO notification_staff_reads (notification_id, user_id)
        SELECT id, $2 FROM notifications WHERE salon_id = $1 AND type = 'appointment'
        AND $2::uuid = ANY(recipient_user_ids) ON CONFLICT DO NOTHING`, [salonId, staffUserId]);
      return;
    }
    await pool.query(`UPDATE notifications SET is_read = true WHERE salon_id = $1 AND is_read = false`, [salonId]);
  },

  async getUnreadCount(salonId: string, staffUserId?: string): Promise<number> {
    const { rows } = staffUserId ? await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM notifications n WHERE salon_id = $1 AND type = 'appointment'
       AND $2::uuid = ANY(recipient_user_ids) AND NOT EXISTS (
         SELECT 1 FROM notification_staff_reads r WHERE r.notification_id = n.id AND r.user_id = $2)`, [salonId, staffUserId])
      : await pool.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM notifications WHERE salon_id = $1 AND is_read = false`, [salonId]);
    return parseInt(rows[0]?.count ?? "0", 10);
  },


  // "All Branches" view for a branch owner — same shape as listBySalon plus
  // salon_name, so an aggregated feed can label which salon each row
  // belongs to (the single-salon view already has that context from its own
  // active-branch switcher, so it doesn't need the name on each row).
  async listBySalons(salonIds: string[], limit = 30): Promise<(Notification & { salon_name: string })[]> {
    if (salonIds.length === 0) return [];
    const { rows } = await pool.query<Notification & { salon_name: string }>(
      `SELECT n.*, COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
       FROM notifications n
       JOIN salons s ON s.id = n.salon_id
       WHERE n.salon_id = ANY($1::uuid[])
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [salonIds, limit]
    );
    return rows;
  },


  async markAllReadForSalons(salonIds: string[]) {
    if (salonIds.length === 0) return;
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE salon_id = ANY($1::uuid[]) AND is_read = false`,
      [salonIds]
    );
  },


  async getUnreadCountForSalons(salonIds: string[]): Promise<number> {
    if (salonIds.length === 0) return 0;
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE salon_id = ANY($1::uuid[]) AND is_read = false`,
      [salonIds]
    );
    return parseInt(rows[0]?.count ?? "0", 10);
  },
};
