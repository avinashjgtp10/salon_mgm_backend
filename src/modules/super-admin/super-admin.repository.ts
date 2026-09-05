import pool from "../../config/database";
import bcrypt from "bcrypt";
import { purgeSalon, clearSalonData as clearSalonDataRows } from "../salons/salons.repository";

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
           WHERE role = 'client' AND DATE(created_at) = CURRENT_DATE)                   AS new_clients_today,
        (SELECT COALESCE(SUM(net_amount), 0)::numeric
           FROM payments
           WHERE status IN ('completed','partial')
             AND DATE(created_at) = CURRENT_DATE)                                       AS revenue_today,
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

  // Owner (from salons.owner_id/users) plus every row in `staff` for this
  // salon, each with lifetime revenue attributed the same way the
  // salon-owner-facing dashboard does it (sales.staff_id / sale_items.staff_id,
  // falling back to open partial payments via appointments.staff_id — see
  // salon-dashboard.repository.ts::getStaffRevenue).
  async getSalonStaff(salonId: string) {
    const { rows } = await pool.query(`
      WITH sales_rows AS (
        SELECT COALESCE(si.staff_id, sl.staff_id) AS staff_id,
               COALESCE(si.total_price, sl.total_amount)::numeric AS amount
        FROM sales sl
        LEFT JOIN sale_items si ON si.sale_id = sl.id
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
      ),
      open_partial_rows AS (
        SELECT a.staff_id, p.paid_amount::numeric AS amount
        FROM payments p
        JOIN appointments a ON a.id = p.appointment_id
        WHERE p.salon_id = $1
          AND p.status = 'partial'
          AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'no-show')
          AND NOT EXISTS (
            SELECT 1 FROM sales s2
            WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
          )
      ),
      revenue_by_staff AS (
        SELECT staff_id, SUM(amount) AS revenue
        FROM (
          SELECT staff_id, amount FROM sales_rows
          UNION ALL
          SELECT staff_id, amount FROM open_partial_rows
        ) x
        WHERE staff_id IS NOT NULL
        GROUP BY staff_id
      )
      SELECT
        u.id,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS name,
        u.email,
        u.phone,
        'owner'                                                  AS role,
        u.is_active,
        u.last_login,
        COALESCE(u.login_count, 0)                                AS login_count,
        0::numeric                                                AS revenue,
        0                                                          AS sort_rank
      FROM salons s
      JOIN users u ON u.id = s.owner_id
      WHERE s.id = $1

      UNION ALL

      SELECT
        st.id,
        TRIM(CONCAT(st.first_name,' ',COALESCE(st.last_name,''))) AS name,
        st.email,
        st.phone,
        COALESCE(st.designation, 'staff')                          AS role,
        st.is_active,
        NULL::timestamptz                                          AS last_login,
        0                                                           AS login_count,
        COALESCE(rbs.revenue, 0)::numeric                          AS revenue,
        1                                                           AS sort_rank
      FROM staff st
      LEFT JOIN revenue_by_staff rbs ON rbs.staff_id = st.id
      WHERE st.salon_id = $1

      ORDER BY sort_rank, revenue DESC
    `, [salonId]);
    return rows.map(({ sort_rank, ...row }) => row);
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

  async updateSalonPermissions(salonId: string, permissions: Record<string, { owner: boolean; staff: boolean; manager?: boolean }>) {
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

  // ── SUBSCRIPTION PERMISSIONS ──────────────────────────────────────────────────
  // Same salon_settings key-value pattern as role_permissions above, under its
  // own key so the two feature areas don't collide. Controls which
  // subscription-related actions (view/renew/upgrade/downgrade/cancel/billing
  // history/payment methods) an ACCOUNT (owner/admin included, not just staff)
  // is allowed to perform — enforced by requireSubscriptionPermission()
  // middleware on every request, so changes apply without requiring logout.

  // Every salon's subscription lifecycle (trial or paid) is tracked in the
  // Razorpay-integrated `subscriptions` table, not `billing_subscriptions`
  // (that one is only ever written by the legacy/manual-comp paid-checkout
  // path and a super-admin "grant days" action, so it's empty for almost
  // every real account — trial_start/trial_end cover trial accounts,
  // current_period_start/end cover paid ones).
  async searchSalonsForSubscriptionPermissions(query: string) {
    const param = query ? `%${query.trim()}%` : "%";
    const { rows } = await pool.query(`
      SELECT
        s.id,
        COALESCE(s.business_name, s.slug, 'Unnamed')           AS name,
        s.is_active,
        u.email                                                  AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS owner_name,
        sp.name                                                  AS plan_name,
        sub.status                                               AS subscription_status,
        COALESCE(sub.trial_start, sub.current_period_start)      AS subscription_start_date,
        COALESCE(sub.trial_end, sub.current_period_end)          AS subscription_end_date,
        sub.cancel_at_period_end                                 AS subscription_cancel_at_period_end,
        sub.cancelled_at                                         AS subscription_cancelled_at,
        sub.is_trial                                             AS subscription_is_trial,
        ss.value                                                 AS subscription_permissions
      FROM salons s
      JOIN  users u  ON u.id = s.owner_id
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions
        WHERE salon_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) sub ON true
      LEFT JOIN subscription_plans sp ON sp.id = sub.plan_id
      LEFT JOIN salon_settings ss ON ss.salon_id = s.id AND ss.key = 'subscription_permissions'
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

  async getSubscriptionPermissionsById(salonId: string) {
    const { rows } = await pool.query(`
      SELECT
        s.id,
        COALESCE(s.business_name, s.slug, 'Unnamed')           AS name,
        s.is_active,
        u.email                                                  AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS owner_name,
        sp.name                                                  AS plan_name,
        sub.status                                               AS subscription_status,
        COALESCE(sub.trial_start, sub.current_period_start)      AS subscription_start_date,
        COALESCE(sub.trial_end, sub.current_period_end)          AS subscription_end_date,
        sub.cancel_at_period_end                                 AS subscription_cancel_at_period_end,
        sub.cancelled_at                                         AS subscription_cancelled_at,
        sub.is_trial                                             AS subscription_is_trial,
        ss.value                                                 AS subscription_permissions
      FROM salons s
      JOIN  users u  ON u.id = s.owner_id
      LEFT JOIN LATERAL (
        SELECT * FROM subscriptions
        WHERE salon_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) sub ON true
      LEFT JOIN subscription_plans sp ON sp.id = sub.plan_id
      LEFT JOIN salon_settings ss ON ss.salon_id = s.id AND ss.key = 'subscription_permissions'
      WHERE s.id = $1
      LIMIT 1
    `, [salonId]);
    return rows[0] ?? null;
  },

  async updateSubscriptionPermissions(
    salonId: string,
    permissions: Record<string, boolean>,
    changedByUserId: string
  ) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: prevRows } = await client.query(
        `SELECT value FROM salon_settings WHERE salon_id = $1 AND key = 'subscription_permissions' LIMIT 1`,
        [salonId]
      );
      const previousValue = prevRows[0]?.value ? JSON.parse(prevRows[0].value) : null;

      const value = JSON.stringify(permissions);
      const { rows } = await client.query(`
        INSERT INTO salon_settings (salon_id, key, value, description)
        VALUES ($1, 'subscription_permissions', $2, 'Per-account subscription action permissions managed by super admin')
        ON CONFLICT (salon_id, key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW()
        RETURNING salon_id, key, updated_at
      `, [salonId, value]);

      await client.query(
        `INSERT INTO subscription_permission_audit_log (salon_id, changed_by, previous_value, new_value)
         VALUES ($1, $2, $3, $4)`,
        [salonId, changedByUserId, previousValue ? JSON.stringify(previousValue) : null, value]
      );

      await client.query("COMMIT");
      return rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async getSubscriptionPermissionAuditLog(salonId: string, limit = 50) {
    const { rows } = await pool.query(`
      SELECT
        al.id, al.previous_value, al.new_value, al.created_at,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS changed_by_name,
        u.email AS changed_by_email
      FROM subscription_permission_audit_log al
      JOIN users u ON u.id = al.changed_by
      WHERE al.salon_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2
    `, [salonId, limit]);
    return rows;
  },

  // Reuses subscription_permission_audit_log for "grant N days" actions too —
  // new_value carries { action: 'grant_days', days, new_current_period_end }
  // so a single audit trail/UI can show both permission toggles and day
  // grants for a salon, distinguished by the `action` field.
  async logSubscriptionGrantDays(salonId: string, changedByUserId: string, days: number, newPeriodEnd: string) {
    const value = JSON.stringify({ action: "grant_days", days, new_current_period_end: newPeriodEnd });
    await pool.query(
      `INSERT INTO subscription_permission_audit_log (salon_id, changed_by, previous_value, new_value)
       VALUES ($1, $2, NULL, $3)`,
      [salonId, changedByUserId, value]
    );
  },

  // Reuses subscription_permission_audit_log for "apply subscription" (explicit
  // start/end dates) too — new_value carries
  // { action: 'apply_subscription', start_date, end_date }.
  async logSubscriptionApply(salonId: string, changedByUserId: string, startDate: string, endDate: string) {
    const value = JSON.stringify({ action: "apply_subscription", start_date: startDate, end_date: endDate });
    await pool.query(
      `INSERT INTO subscription_permission_audit_log (salon_id, changed_by, previous_value, new_value)
       VALUES ($1, $2, NULL, $3)`,
      [salonId, changedByUserId, value]
    );
  },

  // Reuses subscription_permission_audit_log for "remove subscription" too —
  // new_value carries { action: 'remove_subscription' }.
  async logSubscriptionRemove(salonId: string, changedByUserId: string) {
    const value = JSON.stringify({ action: "remove_subscription" });
    await pool.query(
      `INSERT INTO subscription_permission_audit_log (salon_id, changed_by, previous_value, new_value)
       VALUES ($1, $2, NULL, $3)`,
      [salonId, changedByUserId, value]
    );
  },

  // ── USERS ─────────────────────────────────────────────────────────────────────

  async createUser(data: {
    first_name: string;
    last_name?: string;
    email: string;
    password_hash: string;
    phone?: string;
    role: string;
    business_name?: string;
    address?: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: userRows } = await client.query(`
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
      const user = userRows[0];

      if (data.business_name?.trim() && data.role === "salon_owner") {
        const slug = data.business_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now();
        await client.query(`
          INSERT INTO salons (owner_id, business_name, slug, address, is_active, onboarding_completed)
          VALUES ($1, $2, $3, $4, true, false)
        `, [user.id, data.business_name.trim(), slug, data.address?.trim() ?? null]);
      }

      await client.query("COMMIT");
      return user;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async getAllUsers(search?: string, role?: string, minLogins?: number) {
    const searchParam    = search    ? `%${search}%` : null;
    const roleParam      = role      || null;
    const minLoginsParam = minLogins ?? null;
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
        COALESCE(u.login_count, 0)                               AS login_count,
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
        AND ($3::int  IS NULL OR COALESCE(u.login_count, 0) >= $3)
      ORDER BY u.login_count DESC NULLS LAST, u.created_at DESC
      LIMIT 500
    `, [searchParam, roleParam, minLoginsParam]);
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

  async deleteUser(id: string, deletedByUserId: string, reason?: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Snapshotted BEFORE the delete for deleted_account_log — the users
      // row is gone immediately after, so email/name/role can't be joined
      // back later the way every other audit log in this app does.
      const { rows: users } = await client.query(
        `SELECT id, email, role, TRIM(CONCAT(first_name,' ',COALESCE(last_name,''))) AS name
         FROM users WHERE id = $1 FOR UPDATE`,
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

      if (rows[0]) {
        await client.query(
          `INSERT INTO deleted_account_log (account_type, account_id, account_email, account_name, account_role, deleted_by, reason)
           VALUES ('user', $1, $2, $3, $4, $5, $6)`,
          [id, user.email, user.name, user.role, deletedByUserId, reason ?? null]
        );
      }

      await client.query("COMMIT");
      return rows[0] ?? null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // ── DELETE ACCOUNT HISTORY ────────────────────────────────────────────────────

  async getDeletedAccountHistory(opts: { search?: string; accountType?: string; limit: number; offset: number }) {
    const { search, accountType, limit, offset } = opts;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (accountType) {
      params.push(accountType);
      conditions.push(`dal.account_type = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(dal.account_email ILIKE $${params.length} OR dal.account_name ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM deleted_account_log dal ${where}`,
      params
    );

    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT
        dal.id, dal.account_type, dal.account_id, dal.account_email, dal.account_name,
        dal.account_role, dal.reason, dal.created_at,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS deleted_by_name,
        u.email AS deleted_by_email
      FROM deleted_account_log dal
      LEFT JOIN users u ON u.id = dal.deleted_by
      ${where}
      ORDER BY dal.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return { items: rows, total: countRows[0]?.total ?? 0 };
  },

  // ── PAYMENTS ──────────────────────────────────────────────────────────────────

  async deleteSalon(id: string, deletedByUserId: string, reason?: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Snapshotted BEFORE purgeSalon/the owner delete for
      // deleted_account_log, same reasoning as deleteUser above.
      // Locks only `salons` — FOR UPDATE can't be applied across a LEFT JOIN
      // (Postgres rejects locking the nullable side of an outer join), so
      // the owner's email is fetched separately below instead of joined in.
      const { rows: salons } = await client.query(
        `SELECT id, owner_id, COALESCE(business_name, slug, 'Unnamed') AS name
         FROM salons WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!salons[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const ownerId = salons[0].owner_id;

      // Fetched separately (not joined into the locked SELECT above — see
      // that query's comment) BEFORE the owner's user row is possibly
      // deleted below, so deleted_account_log still gets an email.
      let ownerEmail: string | null = null;
      if (ownerId) {
        const { rows: ownerRows } = await client.query(`SELECT email FROM users WHERE id = $1`, [ownerId]);
        ownerEmail = ownerRows[0]?.email ?? null;
      }

      // Deletes every row scoped to this salon, including tables with no FK
      // to salons (appointments, sales, bundles, etc.) that ON DELETE CASCADE
      // never reaches on its own — see purgeSalon's own comment for the full
      // list and why each one needs an explicit delete.
      const deleted = await purgeSalon(client, id);

      // "Delete the salon" means every account related to it, not just the
      // business data — an ownerless (salon_id-less) user row left behind
      // would look like the deletion only half-worked. Skip this if the
      // owner still owns another salon (multi-salon owners keep their login).
      if (ownerId) {
        const { rows: stillOwns } = await client.query(
          `SELECT id FROM salons WHERE owner_id = $1 LIMIT 1`,
          [ownerId]
        );
        if (!stillOwns[0]) {
          await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ownerId]);
          await client.query(`DELETE FROM otp_verifications WHERE user_id = $1`, [ownerId]);
          await client.query(`DELETE FROM user_identities WHERE user_id = $1`, [ownerId]);
          await client.query(`UPDATE staff SET user_id = NULL, updated_at = NOW() WHERE user_id = $1`, [ownerId]);
          await client.query(`UPDATE support_tickets SET user_id = NULL, updated_at = NOW() WHERE user_id = $1`, [ownerId]);
          await client.query(`DELETE FROM users WHERE id = $1 AND role != 'super_admin'`, [ownerId]);
        }
      }

      await client.query(
        `INSERT INTO deleted_account_log (account_type, account_id, account_email, account_name, account_role, deleted_by, reason)
         VALUES ('salon', $1, $2, $3, 'salon_owner', $4, $5)`,
        [id, ownerEmail, salons[0].name, deletedByUserId, reason ?? null]
      );

      await client.query("COMMIT");
      return deleted;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async clearSalonData(id: string, clearedByUserId: string, reason?: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // FOR UPDATE guards against a concurrent request racing this same
      // salon (e.g. double-click on "Clear All Data"). Name snapshotted for
      // salon_cleanup_log so History still reads correctly even if the
      // salon is later renamed or deleted outright.
      const { rows: salons } = await client.query(
        `SELECT id, COALESCE(business_name, slug, 'Unnamed') AS name FROM salons WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!salons[0]) {
        await client.query("ROLLBACK");
        return false;
      }
      const cleared = await clearSalonDataRows(client, id);

      await client.query(
        `INSERT INTO salon_cleanup_log (salon_id, salon_name, cleared_by, reason)
         VALUES ($1, $2, $3, $4)`,
        [id, salons[0].name, clearedByUserId, reason ?? null]
      );

      await client.query("COMMIT");
      return cleared;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // ── SALON CLEANUP HISTORY ─────────────────────────────────────────────────────

  async getSalonCleanupHistory(opts: { search?: string; limit: number; offset: number }) {
    const { search, limit, offset } = opts;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`scl.salon_name ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM salon_cleanup_log scl ${where}`,
      params
    );

    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT
        scl.id, scl.salon_id, scl.salon_name, scl.reason, scl.created_at,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))) AS cleared_by_name,
        u.email AS cleared_by_email
      FROM salon_cleanup_log scl
      LEFT JOIN users u ON u.id = scl.cleared_by
      ${where}
      ORDER BY scl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    return { items: rows, total: countRows[0]?.total ?? 0 };
  },

  // ── PAYMENTS ──────────────────────────────────────────────────────────────────

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

};
