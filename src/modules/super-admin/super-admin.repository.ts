import pool from "../../config/database";
import bcrypt from "bcrypt";

export const superAdminRepository = {

  // ── AUTH ──────────────────────────────────────────────────────────────────────

  async findSuperAdminByEmail(email: string) {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, role, is_active
       FROM users WHERE email = $1 AND role = 'super_admin' LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  // ── FREQUENT LOGINS ──────────────────────────────────────────────────────────

  async getFrequentLogins(limit = 10) {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS name,
        u.email,
        u.role,
        u.last_login,
        COALESCE(u.login_count, 0)                              AS login_count,
        u.is_active,
        COALESCE(s.business_name, s.slug, NULL)                 AS salon_name
      FROM users u
      LEFT JOIN salons s ON s.owner_id = u.id
      WHERE u.role != 'super_admin'
        AND COALESCE(u.login_count, 0) > 0
      ORDER BY u.login_count DESC, u.last_login DESC
      LIMIT $1
    `, [limit]);
    return rows;
  },

  // ── USERS WITHOUT SUBSCRIPTION ────────────────────────────────────────────

  async getUsersWithoutSubscription(limit = 20) {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS name,
        u.email,
        u.role,
        u.last_login,
        COALESCE(u.login_count, 0)                              AS login_count,
        u.created_at,
        u.is_active,
        COALESCE(s.business_name, s.slug, NULL)                 AS salon_name,
        s.id                                                     AS salon_id
      FROM users u
      LEFT JOIN salons s ON s.owner_id = u.id
      WHERE u.role IN ('salon_owner', 'admin')
        AND u.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM billing_subscriptions bs
          WHERE bs.salon_id = s.id
            AND bs.status IN ('active', 'trialing')
        )
        AND s.id IS NOT NULL
      ORDER BY u.last_login DESC NULLS LAST
      LIMIT $1
    `, [limit]);
    return rows;
  },

  // ── RECENT LOGINS ────────────────────────────────────────────────────────────

  async getRecentLogins(limit = 10) {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS name,
        u.email,
        u.role,
        u.last_login,
        u.is_active,
        COALESCE(s.business_name, s.slug, NULL)                 AS salon_name
      FROM users u
      LEFT JOIN salons s ON s.owner_id = u.id
      WHERE u.role != 'super_admin'
        AND u.last_login IS NOT NULL
      ORDER BY u.last_login DESC
      LIMIT $1
    `, [limit]);
    return rows;
  },

  // ── STATS ─────────────────────────────────────────────────────────────────────

  async getStats() {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM salons)                                               AS total_salons,
        (SELECT COUNT(*)::int FROM salons WHERE is_active = true)                        AS active_salons,
        (SELECT COUNT(*)::int FROM salons WHERE is_active = false)                       AS inactive_salons,
        (SELECT COUNT(*)::int FROM users  WHERE role != 'super_admin')                   AS total_users,
        (SELECT COUNT(*)::int FROM users  WHERE role = 'salon_owner')                    AS total_owners,
        (SELECT COUNT(*)::int FROM users  WHERE role = 'staff')                          AS total_staff,
        (SELECT COUNT(*)::int FROM users  WHERE role = 'client')                         AS total_clients,
        (SELECT COALESCE(SUM(net_amount), 0)::numeric
           FROM payments WHERE status IN ('completed','partial'))                         AS total_revenue,
        (SELECT COALESCE(SUM(net_amount), 0)::numeric
           FROM payments
           WHERE status IN ('completed','partial')
             AND created_at >= date_trunc('month', NOW()))                               AS mrr,
        (SELECT COUNT(*)::int FROM appointments)                                         AS total_bookings,
        (SELECT COUNT(*)::int FROM appointments WHERE DATE(created_at) = CURRENT_DATE)   AS bookings_today,
        (SELECT COUNT(*)::int FROM users
           WHERE role != 'super_admin' AND DATE(created_at) = CURRENT_DATE)             AS signups_today,
        (SELECT COUNT(*)::int FROM users
           WHERE role != 'super_admin' AND created_at >= NOW() - INTERVAL '7 days')     AS signups_this_week,
        (SELECT COUNT(*)::int FROM users
           WHERE role != 'super_admin' AND created_at >= date_trunc('month', NOW()))    AS signups_this_month,
        (SELECT COUNT(*)::int FROM payments WHERE status = 'failed')                     AS failed_payments,
        (SELECT COUNT(*)::int FROM salons WHERE created_at >= date_trunc('month', NOW())) AS new_salons_this_month,
        (SELECT COUNT(*)::int FROM billing_subscriptions WHERE status IN ('active','trialing')) AS active_subscriptions
    `);
    return rows[0];
  },

  // ── SALONS ────────────────────────────────────────────────────────────────────

  async getAllSalons(search?: string) {
    const param = search ? `%${search}%` : null;
    const { rows } = await pool.query(`
      SELECT
        s.id,
        COALESCE(s.business_name, s.slug, 'Unnamed')                                    AS name,
        u.email                                                                           AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,'')))                         AS owner_name,
        CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END                         AS status,
        COALESCE(u.is_onboarding_complete, false)                                       AS is_onboarding_complete,
        s.created_at,
        (SELECT COUNT(*)::int  FROM staff        WHERE salon_id = s.id)                  AS staff_count,
        (SELECT COUNT(*)::int  FROM clients      WHERE salon_id = s.id)                  AS client_count,
        (SELECT COUNT(*)::int  FROM appointments WHERE salon_id = s.id)                  AS total_bookings,
        COALESCE((
          SELECT SUM(net_amount) FROM payments
          WHERE salon_id = s.id AND status IN ('completed','partial')
        ), 0)::numeric                                                                    AS revenue,
        (SELECT bs.status FROM billing_subscriptions bs
           WHERE bs.salon_id = s.id AND bs.status IN ('active','trialing')
           ORDER BY bs.created_at DESC LIMIT 1)                                           AS subscription_status,
        (SELECT bp.name FROM billing_subscriptions bs
           JOIN billing_plans bp ON bp.id = bs.plan_id
           WHERE bs.salon_id = s.id AND bs.status IN ('active','trialing')
           ORDER BY bs.created_at DESC LIMIT 1)                                           AS plan_name
      FROM salons s
      LEFT JOIN users u ON u.id = s.owner_id
      WHERE ($1::text IS NULL
         OR s.business_name ILIKE $1
         OR s.slug          ILIKE $1
         OR u.email         ILIKE $1
         OR u.first_name    ILIKE $1)
      ORDER BY s.created_at DESC
    `, [param]);
    return rows;
  },

  async getSalonById(id: string) {
    const { rows } = await pool.query(`
      SELECT
        s.*,
        COALESCE(s.business_name, s.slug, 'Unnamed')                        AS name,
        u.email                                                               AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,'')))             AS owner_name,
        u.phone                                                               AS owner_phone,
        u.id                                                                  AS owner_user_id,
        bs.status                                                             AS subscription_status,
        bp.name                                                               AS plan_name,
        bp.price_per_unit                                                     AS plan_price
      FROM salons s
      LEFT JOIN users u               ON u.id     = s.owner_id
      LEFT JOIN billing_subscriptions bs ON bs.salon_id = s.id AND bs.status IN ('active','trialing')
      LEFT JOIN billing_plans bp      ON bp.id    = bs.plan_id
      WHERE s.id = $1 LIMIT 1
    `, [id]);
    return rows[0] || null;
  },

  async setSalonStatus(id: string, isActive: boolean) {
    const { rows } = await pool.query(
      `UPDATE salons SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active`,
      [isActive, id]
    );
    return rows[0];
  },

  async forceCompleteOnboarding(id: string) {
    const { rows } = await pool.query(
      `UPDATE users SET is_onboarding_complete = true, updated_at = NOW()
       WHERE id = (SELECT owner_id FROM salons WHERE id = $1)
       RETURNING id`,
      [id]
    );
    return rows[0];
  },

  async getSalonOwnerId(salonId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT owner_id FROM salons WHERE id = $1 LIMIT 1`,
      [salonId]
    );
    return rows[0]?.owner_id ?? null;
  },

  async getUserForImpersonate(userId: string) {
    const { rows } = await pool.query(`
      SELECT u.id, u.role, u.is_active,
             COALESCE(s.id, st.salon_id) AS salon_id,
             COALESCE(u.is_onboarding_complete, false) AS is_onboarding_complete
      FROM users u
      LEFT JOIN salons s  ON s.owner_id = u.id
      LEFT JOIN staff  st ON st.user_id = u.id
      WHERE u.id = $1 LIMIT 1
    `, [userId]);
    return rows[0] ?? null;
  },

  // ── SALON PERMISSIONS ────────────────────────────────────────────────────────

  async searchSalonsForPermissions(query: string) {
    const param = query ? `%${query.trim()}%` : "%";
    const { rows } = await pool.query(`
      SELECT
        s.id,
        COALESCE(s.business_name, s.slug, 'Unnamed')           AS name,
        s.is_active,
        u.email                                                  AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS owner_name,
        bp.name                                                  AS plan_name,
        ss.value                                                 AS role_permissions
      FROM salons s
      JOIN  users u  ON u.id = s.owner_id
      LEFT JOIN billing_subscriptions bs ON bs.salon_id = s.id AND bs.status IN ('active','trialing')
      LEFT JOIN billing_plans bp ON bp.id = bs.plan_id
      LEFT JOIN salon_settings ss ON ss.salon_id = s.id AND ss.key = 'role_permissions'
      WHERE (
        s.business_name ILIKE $1
        OR s.slug        ILIKE $1
        OR u.email       ILIKE $1
        OR u.first_name  ILIKE $1
        OR u.last_name   ILIKE $1
      )
      ORDER BY s.business_name ASC
      LIMIT 50
    `, [param]);
    return rows;
  },

  async getSalonPermissionsById(salonId: string) {
    const { rows } = await pool.query(`
      SELECT
        s.id,
        COALESCE(s.business_name, s.slug, 'Unnamed')           AS name,
        s.is_active,
        u.email                                                  AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS owner_name,
        bp.name                                                  AS plan_name,
        ss.value                                                 AS role_permissions
      FROM salons s
      JOIN  users u  ON u.id = s.owner_id
      LEFT JOIN billing_subscriptions bs ON bs.salon_id = s.id AND bs.status IN ('active','trialing')
      LEFT JOIN billing_plans bp ON bp.id = bs.plan_id
      LEFT JOIN salon_settings ss ON ss.salon_id = s.id AND ss.key = 'role_permissions'
      WHERE s.id = $1
      LIMIT 1
    `, [salonId]);
    return rows[0] ?? null;
  },

  async updateSalonPermissions(salonId: string, permissions: Record<string, { owner: boolean; staff: boolean }>) {
    const value = JSON.stringify(permissions);
    const { rows } = await pool.query(`
      INSERT INTO salon_settings (salon_id, key, value, description)
      VALUES ($1, 'role_permissions', $2, 'Role-level permissions managed by super admin')
      ON CONFLICT (salon_id, key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING salon_id, key, updated_at
    `, [salonId, value]);
    return rows[0];
  },

  // ── USERS ─────────────────────────────────────────────────────────────────────

  async createUser(data: {
    first_name: string;
    last_name?: string;
    email: string;
    password_hash: string;
    phone?: string;
    role: string;
  }) {
    const { rows } = await pool.query(`
      INSERT INTO users (first_name, last_name, email, password_hash, phone, role, is_active, is_onboarding_complete)
      VALUES ($1, $2, $3, $4, $5, $6, true, false)
      RETURNING id, first_name, last_name, email, phone, role, is_active, created_at
    `, [
      data.first_name,
      data.last_name ?? null,
      data.email.toLowerCase().trim(),
      data.password_hash,
      data.phone ?? null,
      data.role,
    ]);
    return rows[0];
  },

  async getAllUsers(search?: string, role?: string) {
    const searchParam = search ? `%${search}%` : null;
    const roleParam   = role   || null;
    const { rows } = await pool.query(`
      SELECT
        u.id,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS name,
        u.email,
        u.phone,
        u.role,
        u.is_active,
        u.last_login,
        u.created_at,
        CASE WHEN u.is_active THEN 'active' ELSE 'inactive' END AS status,
        COALESCE(s.business_name, s.slug)                        AS salon_name,
        s.id                                                      AS salon_id
      FROM users u
      LEFT JOIN salons s ON s.owner_id = u.id
      WHERE u.role != 'super_admin'
        AND ($1::text IS NULL
          OR u.email      ILIKE $1
          OR u.first_name ILIKE $1
          OR u.last_name  ILIKE $1
          OR u.phone      ILIKE $1)
        AND ($2::text IS NULL OR u.role = $2)
      ORDER BY u.created_at DESC
      LIMIT 500
    `, [searchParam, roleParam]);
    return rows;
  },

  async setUserStatus(id: string, isActive: boolean) {
    const { rows } = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active`,
      [isActive, id]
    );
    return rows[0];
  },

  async setUserRole(id: string, role: string) {
    const { rows } = await pool.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, role`,
      [role, id]
    );
    return rows[0];
  },

  async resetUserPassword(id: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hash, id]
    );
  },

  async deleteUser(id: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: users } = await client.query(
        `SELECT id, role FROM users WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const user = users[0];
      if (!user) {
        await client.query("ROLLBACK");
        return null;
      }

      const { rows: ownedSalons } = await client.query(
        `SELECT id FROM salons WHERE owner_id = $1 LIMIT 1`,
        [id]
      );
      if (ownedSalons[0]) {
        await client.query("ROLLBACK");
        return { blocked: "owns_salon", salon_id: ownedSalons[0].id };
      }

      await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM otp_verifications WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM user_identities WHERE user_id = $1`, [id]);
      await client.query(`UPDATE staff SET user_id = NULL, updated_at = NOW() WHERE user_id = $1`, [id]);
      await client.query(`UPDATE support_tickets SET user_id = NULL, updated_at = NOW() WHERE user_id = $1`, [id]);

      const { rows } = await client.query(
        `DELETE FROM users WHERE id = $1 AND role != 'super_admin' RETURNING id`,
        [id]
      );

      await client.query("COMMIT");
      return rows[0] ?? null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // ── PAYMENTS ──────────────────────────────────────────────────────────────────

  async deleteSalon(id: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: salons } = await client.query(
        `SELECT id, owner_id FROM salons WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!salons[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      // Tables with no FK constraint to salons — must delete manually
      await client.query(`DELETE FROM invoices              WHERE salon_id = $1`, [id]);
      await client.query(`DELETE FROM billing_subscriptions WHERE salon_id = $1`, [id]);

      // Delete the salon — FK ON DELETE CASCADE handles staff, clients,
      // appointments, payments, services, categories, salon_settings, bookings, etc.
      const { rows } = await client.query(
        `DELETE FROM salons WHERE id = $1 RETURNING id`,
        [id]
      );

      await client.query("COMMIT");
      return rows[0] ?? null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async getAllPayments(statusFilter?: string) {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        COALESCE(s.business_name, s.slug, 'Unknown') AS salon_name,
        s.id                                           AS salon_id,
        p.net_amount                                   AS amount,
        p.status,
        p.payment_method,
        p.created_at
      FROM payments p
      LEFT JOIN salons s ON s.id = p.salon_id
      WHERE ($1::text IS NULL OR p.status = $1)
      ORDER BY p.created_at DESC
      LIMIT 500
    `, [statusFilter || null]);
    return rows;
  },

  // ── BILLING / SUBSCRIPTIONS ───────────────────────────────────────────────────

  async getAllSubscriptions(statusFilter?: string) {
    const { rows } = await pool.query(`
      SELECT
        bs.id,
        bs.salon_id,
        COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
        u.email                                        AS owner_email,
        bp.name                                        AS plan_name,
        bp.price_per_unit,
        bp.interval,
        bs.status,
        bs.current_period_start,
        bs.current_period_end,
        bs.created_at
      FROM billing_subscriptions bs
      LEFT JOIN salons s     ON s.id  = bs.salon_id
      LEFT JOIN users u      ON u.id  = s.owner_id
      LEFT JOIN billing_plans bp ON bp.id = bs.plan_id
      WHERE ($1::text IS NULL OR bs.status = $1)
      ORDER BY bs.created_at DESC
    `, [statusFilter || null]);
    return rows;
  },

  async getAllPlans() {
    const { rows } = await pool.query(
      `SELECT * FROM billing_plans ORDER BY price_per_unit ASC`
    );
    return rows;
  },
};
