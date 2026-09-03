import pool, { safeQuery } from "../../config/database";

export const branchOwnerRepository = {

  // Per-salon breakdown for the "My Salons" table — same revenue convention
  // (completed sale, or an open partial deposit with no completed sale yet)
  // as getSummary() in salon-dashboard.repository.ts and the aggregate
  // version of this query in getDashboardStats() above, just grouped by
  // salon here instead of summed across all of them.
  async getMySalons(branchOwnerId: string) {
    const { rows } = await pool.query(`
      SELECT
        s.id,
        s.owner_id,
        COALESCE(s.business_name, s.slug, 'Unnamed')                                    AS name,
        s.city                                                                           AS location,
        u.email                                                                           AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,'')))                         AS owner_name,
        CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END                         AS status,
        s.created_at,
        COALESCE(staff_counts.staff_count, 0)                                            AS staff_count,
        COALESCE(client_counts.client_count, 0)                                          AS client_count,
        COALESCE(appt_counts.appointments_today, 0)                                      AS appointments_today,
        COALESCE(revenue.revenue_today, 0)                                               AS revenue_today
      FROM branch_owner_salons bos
      JOIN salons s ON s.id = bos.salon_id
      LEFT JOIN users u ON u.id = s.owner_id
      LEFT JOIN (
        SELECT salon_id, COUNT(*)::int AS staff_count
        FROM staff
        WHERE is_active = true
        GROUP BY salon_id
      ) staff_counts ON staff_counts.salon_id = s.id
      LEFT JOIN (
        SELECT salon_id, COUNT(DISTINCT client_id)::int AS client_count
        FROM (
          SELECT salon_id, client_id FROM appointments WHERE client_id IS NOT NULL AND deleted_at IS NULL
          UNION
          SELECT salon_id, client_id FROM sales WHERE client_id IS NOT NULL
        ) visited
        GROUP BY salon_id
      ) client_counts ON client_counts.salon_id = s.id
      LEFT JOIN (
        SELECT salon_id, COUNT(*)::int AS appointments_today
        FROM appointments
        WHERE deleted_at IS NULL AND status NOT IN ('cancelled', 'no-show')
          AND DATE(scheduled_at) = CURRENT_DATE
        GROUP BY salon_id
      ) appt_counts ON appt_counts.salon_id = s.id
      LEFT JOIN (
        SELECT salon_id, SUM(amount)::numeric AS revenue_today
        FROM (
          SELECT sa.salon_id, ROUND(sa.total_amount) AS amount, sa.created_at AS event_at
          FROM sales sa
          LEFT JOIN appointments a ON a.id = sa.appointment_id
          WHERE sa.status = 'completed'
            AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
          UNION ALL
          SELECT p.salon_id, p.paid_amount AS amount, p.created_at AS event_at
          FROM payments p
          JOIN appointments a ON a.id = p.appointment_id
          WHERE p.status = 'partial'
            AND a.deleted_at IS NULL
            AND a.status NOT IN ('cancelled', 'no-show')
            AND NOT EXISTS (
              SELECT 1 FROM sales s2 WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
            )
        ) revenue_events
        WHERE DATE(event_at) = CURRENT_DATE
        GROUP BY salon_id
      ) revenue ON revenue.salon_id = s.id
      WHERE bos.branch_owner_id = $1
      ORDER BY s.created_at DESC
    `, [branchOwnerId]);
    return rows;
  },

  // Cross-salon dashboard stats — one query per metric, each scoped to every
  // salon assigned to this branch owner via branch_owner_salons, rather than
  // fanning out N queries (one per salon) like getFinanceOverview does. The
  // dashboard only needs the totals, not a per-salon breakdown, so a single
  // aggregate query per metric is both simpler and cheaper.
  async getDashboardStats(branchOwnerId: string) {
    const [salonCounts, revenueAndBookings, staffCount, clientCount, newClientsToday, activeSubs] = await Promise.all([
      pool.query<{ total_salons: string; active_salons: string; inactive_salons: string }>(`
        SELECT
          COUNT(*)::int                                        AS total_salons,
          COUNT(*) FILTER (WHERE s.is_active)::int              AS active_salons,
          COUNT(*) FILTER (WHERE NOT s.is_active)::int          AS inactive_salons
        FROM branch_owner_salons bos
        JOIN salons s ON s.id = bos.salon_id
        WHERE bos.branch_owner_id = $1
      `, [branchOwnerId]),

      // Revenue/bookings follow the same "completed sale, or an open partial
      // deposit with no completed sale yet" convention as the single-salon
      // dashboard's getSummary() (salon-dashboard.repository.ts), just summed
      // across every assigned salon instead of scoped to one.
      pool.query<{
        total_revenue: string; revenue_today: string;
        total_bookings: string; bookings_today: string;
      }>(`
        WITH my_salons AS (
          SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1
        ),
        sales_rows AS (
          SELECT s.created_at AS event_at, ROUND(s.total_amount) AS amount
          FROM sales s
          LEFT JOIN appointments a ON a.id = s.appointment_id
          WHERE s.salon_id IN (SELECT salon_id FROM my_salons)
            AND s.status = 'completed'
            AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
        ),
        open_partial_rows AS (
          SELECT p.created_at AS event_at, p.paid_amount AS amount
          FROM payments p
          JOIN appointments a ON a.id = p.appointment_id
          WHERE p.salon_id IN (SELECT salon_id FROM my_salons)
            AND p.status = 'partial'
            AND a.deleted_at IS NULL
            AND a.status NOT IN ('cancelled', 'no-show')
            AND NOT EXISTS (
              SELECT 1 FROM sales s2 WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
            )
        ),
        revenue_events AS (
          SELECT event_at, amount FROM sales_rows
          UNION ALL
          SELECT event_at, amount FROM open_partial_rows
        )
        SELECT
          COALESCE((SELECT SUM(amount) FROM revenue_events), 0)::numeric AS total_revenue,
          COALESCE((SELECT SUM(amount) FROM revenue_events WHERE DATE(event_at) = CURRENT_DATE), 0)::numeric AS revenue_today,
          (SELECT COUNT(*) FROM appointments
            WHERE salon_id IN (SELECT salon_id FROM my_salons)
              AND deleted_at IS NULL AND status NOT IN ('cancelled', 'no-show'))::int AS total_bookings,
          (SELECT COUNT(*) FROM appointments
            WHERE salon_id IN (SELECT salon_id FROM my_salons)
              AND deleted_at IS NULL AND status NOT IN ('cancelled', 'no-show')
              AND DATE(scheduled_at) = CURRENT_DATE)::int AS bookings_today
      `, [branchOwnerId]),

      pool.query<{ total_staff: string }>(`
        SELECT COUNT(*)::int AS total_staff
        FROM staff st
        JOIN branch_owner_salons bos ON bos.salon_id = st.salon_id
        WHERE bos.branch_owner_id = $1 AND st.is_active = true
      `, [branchOwnerId]),

      // Clients table has no salon_id — a client "belongs" to a salon only
      // via having an appointment/sale there, same join getSummary() uses.
      pool.query<{ total_clients: string }>(`
        SELECT COUNT(DISTINCT c.id)::int AS total_clients
        FROM clients c
        INNER JOIN (
          SELECT client_id FROM appointments
            WHERE salon_id IN (SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1)
              AND client_id IS NOT NULL AND deleted_at IS NULL
          UNION
          SELECT client_id FROM sales
            WHERE salon_id IN (SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1)
              AND client_id IS NOT NULL
        ) visited ON visited.client_id = c.id
        WHERE c.is_active = true
      `, [branchOwnerId]),

      pool.query<{ new_clients_today: string }>(`
        SELECT COUNT(*)::int AS new_clients_today
        FROM clients c
        WHERE c.is_active = true
          AND DATE(c.created_at) = CURRENT_DATE
          AND EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.client_id = c.id
              AND a.salon_id IN (SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1)
          )
      `, [branchOwnerId]),

      pool.query<{ active_subscriptions: string }>(`
        SELECT COUNT(DISTINCT bs.salon_id)::int AS active_subscriptions
        FROM billing_subscriptions bs
        JOIN branch_owner_salons bos ON bos.salon_id = bs.salon_id
        WHERE bos.branch_owner_id = $1 AND bs.status IN ('trialing', 'active')
      `, [branchOwnerId]),
    ]);

    return {
      total_salons: salonCounts.rows[0]?.total_salons ?? 0,
      active_salons: salonCounts.rows[0]?.active_salons ?? 0,
      inactive_salons: salonCounts.rows[0]?.inactive_salons ?? 0,
      total_staff: staffCount.rows[0]?.total_staff ?? 0,
      total_clients: clientCount.rows[0]?.total_clients ?? 0,
      total_revenue: Number(revenueAndBookings.rows[0]?.total_revenue ?? 0),
      total_bookings: revenueAndBookings.rows[0]?.total_bookings ?? 0,
      bookings_today: revenueAndBookings.rows[0]?.bookings_today ?? 0,
      revenue_today: Number(revenueAndBookings.rows[0]?.revenue_today ?? 0),
      new_clients_today: newClientsToday.rows[0]?.new_clients_today ?? 0,
      active_subscriptions: activeSubs.rows[0]?.active_subscriptions ?? 0,
    };
  },

  // Day-by-day revenue for the dashboard's trend chart — same revenue_events
  // convention (completed sale, or an open partial deposit with no completed
  // sale yet) as getDashboardStats(), just bucketed by day over the trailing
  // window instead of summed into one total. generate_series fills in days
  // with zero revenue so the chart doesn't skip gaps.
  async getRevenueTrend(branchOwnerId: string, days = 14) {
    const { rows } = await pool.query<{ day: string; revenue: string }>(`
      WITH my_salons AS (
        SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1
      ),
      sales_rows AS (
        SELECT s.created_at AS event_at, ROUND(s.total_amount) AS amount
        FROM sales s
        LEFT JOIN appointments a ON a.id = s.appointment_id
        WHERE s.salon_id IN (SELECT salon_id FROM my_salons)
          AND s.status = 'completed'
          AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
      ),
      open_partial_rows AS (
        SELECT p.created_at AS event_at, p.paid_amount AS amount
        FROM payments p
        JOIN appointments a ON a.id = p.appointment_id
        WHERE p.salon_id IN (SELECT salon_id FROM my_salons)
          AND p.status = 'partial'
          AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'no-show')
          AND NOT EXISTS (
            SELECT 1 FROM sales s2 WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
          )
      ),
      revenue_events AS (
        SELECT event_at, amount FROM sales_rows
        UNION ALL
        SELECT event_at, amount FROM open_partial_rows
      ),
      days_series AS (
        SELECT generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, '1 day')::date AS day
      )
      SELECT
        ds.day::text AS day,
        COALESCE(SUM(re.amount), 0)::numeric AS revenue
      FROM days_series ds
      LEFT JOIN revenue_events re ON DATE(re.event_at) = ds.day
      GROUP BY ds.day
      ORDER BY ds.day
    `, [branchOwnerId, days]);
    return rows.map((r) => ({ day: r.day, revenue: Number(r.revenue) }));
  },

  // Cross-salon "Needs Attention" metrics — each one is a real, independently
  // queryable signal (no fabricated proxies). Unpaid invoices reuses the same
  // due_amount>0 convention as the Payment Collection Report; pending bookings
  // maps to appointments.status='booked' (there's no separate "unconfirmed"
  // state in the enum); staff requests maps to pending staff_leaves rows,
  // since that's the only staff-initiated "request" concept in this schema.
  async getAttentionMetrics(branchOwnerId: string) {
    const [unpaid, pendingBookings, staffRequests] = await Promise.all([
      pool.query<{ unpaid_count: string; unpaid_amount: string }>(`
        WITH my_salons AS (
          SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1
        ),
        latest_payment AS (
          SELECT DISTINCT ON (a.id)
            a.id AS appointment_id, p.due_amount
          FROM appointments a
          JOIN payments p ON p.appointment_id = a.id AND p.status <> 'refunded'
          WHERE a.salon_id IN (SELECT salon_id FROM my_salons)
            AND a.deleted_at IS NULL
          ORDER BY a.id, p.created_at DESC, (p.status = 'completed') DESC, p.due_amount ASC
        )
        SELECT
          COUNT(*) FILTER (WHERE due_amount > 0.5)::int AS unpaid_count,
          COALESCE(SUM(due_amount) FILTER (WHERE due_amount > 0.5), 0)::numeric AS unpaid_amount
        FROM latest_payment
      `, [branchOwnerId]),

      pool.query<{ pending_bookings: string }>(`
        SELECT COUNT(*)::int AS pending_bookings
        FROM appointments
        WHERE salon_id IN (SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1)
          AND deleted_at IS NULL
          AND status = 'booked'
      `, [branchOwnerId]),

      pool.query<{ pending_requests: string }>(`
        SELECT COUNT(*)::int AS pending_requests
        FROM staff_leaves sl
        JOIN staff st ON st.id = sl.staff_id
        WHERE st.salon_id IN (SELECT salon_id FROM branch_owner_salons WHERE branch_owner_id = $1)
          AND sl.status = 'pending'
      `, [branchOwnerId]),
    ]);

    return {
      unpaid_invoices_count: unpaid.rows[0]?.unpaid_count ?? 0,
      unpaid_invoices_amount: Number(unpaid.rows[0]?.unpaid_amount ?? 0),
      pending_bookings: pendingBookings.rows[0]?.pending_bookings ?? 0,
      pending_staff_requests: staffRequests.rows[0]?.pending_requests ?? 0,
    };
  },

  async getRecentPayments(branchOwnerId: string, limit = 10, status?: string) {
    const values: any[] = [branchOwnerId];
    let statusClause = "";
    if (status) {
      values.push(status);
      statusClause = `AND p.status = $${values.length}`;
    }
    values.push(limit);
    const { rows } = await pool.query(`
      SELECT
        p.id, p.amount, p.status, p.payment_method, p.created_at,
        s.id                                        AS salon_id,
        COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
        sa.invoice_number                            AS invoice_number
      FROM payments p
      JOIN branch_owner_salons bos ON bos.salon_id = p.salon_id
      JOIN salons s ON s.id = p.salon_id
      LEFT JOIN sales sa ON sa.appointment_id = p.appointment_id AND sa.status = 'completed'
      WHERE bos.branch_owner_id = $1 ${statusClause}
      ORDER BY p.created_at DESC
      LIMIT $${values.length}
    `, values);
    return rows;
  },

  async isSalonAssignedToBranchOwner(branchOwnerId: string, salonId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM branch_owner_salons WHERE branch_owner_id = $1 AND salon_id = $2 LIMIT 1`,
      [branchOwnerId, salonId]
    );
    return rows.length > 0;
  },

  // Cash counter session totals per assigned salon — same source columns as
  // the single-salon Cash Management Report (reports.repository.ts), summed
  // per salon instead of filtered to one, so a branch owner sees every
  // branch's cash position on one screen.
  async getCashManagementBySalon(branchOwnerId: string) {
    const { rows } = await pool.query(`
      SELECT
        s.id                                            AS salon_id,
        COALESCE(s.business_name, s.slug, 'Unnamed')     AS salon_name,
        COALESCE(SUM(cm.opening_balance), 0)             AS total_opening_balance,
        COALESCE(SUM(cm.cash_revenue), 0)                AS total_cash_revenue,
        COALESCE(SUM(cm.cash_expense), 0)                AS total_cash_expense,
        COALESCE(SUM(cm.closing_balance), 0)             AS total_closing_balance,
        COALESCE(SUM(cm.reconciliation_amount), 0)       AS total_reconciliation_amount,
        COUNT(cm.id)::int                                AS total_sessions,
        COUNT(cm.id) FILTER (WHERE cm.status = 'open')::int   AS open_sessions,
        COUNT(cm.id) FILTER (WHERE cm.status = 'closed')::int AS closed_sessions
      FROM branch_owner_salons bos
      JOIN salons s ON s.id = bos.salon_id
      LEFT JOIN cash_management cm ON cm.salon_id = s.id
      WHERE bos.branch_owner_id = $1
      GROUP BY s.id, s.business_name, s.slug
      ORDER BY s.created_at DESC
    `, [branchOwnerId]);
    return rows;
  },

  // Cross-salon stock transfer: products are salon-scoped, no shared catalog
  // — every product row belongs to exactly one salon, so "transfer" means
  // moving a quantity from one salon's product row to (an equivalent
  // product row in) another salon, not moving a single shared row.

  async listProductsForSalon(salonId: string, search?: string): Promise<{ id: string; name: string; barcode: string | null; amount: number; measure_unit: string }[]> {
    const values: unknown[] = [salonId];
    let where = "salon_id = $1 AND is_active = true";
    if (search && search.trim()) {
      values.push(`%${search.trim()}%`);
      where += ` AND name ILIKE $${values.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, name, barcode, amount, measure_unit FROM products WHERE ${where} ORDER BY name ASC LIMIT 50`,
      values
    );
    return rows;
  },

  async findProduct(id: string, salonId: string): Promise<{
    id: string; name: string; barcode: string | null; amount: number; measure_unit: string;
    category_id: string | null; supplier_id: string | null; supply_price: number;
    retail_price: number | null; markup_percentage: number | null;
  } | null> {
    const { rows } = await pool.query(
      `SELECT id, name, barcode, amount, measure_unit, category_id, supplier_id, supply_price, retail_price, markup_percentage
       FROM products WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    );
    return rows[0] ?? null;
  },

  async createProductInSalon(salonId: string, template: {
    name: string; barcode: string | null; measure_unit: string; category_id: string | null;
    supplier_id: string | null; supply_price: number; retail_price: number | null; markup_percentage: number | null;
  }): Promise<{ id: string }> {
    const { rows } = await pool.query(
      `INSERT INTO products (salon_id, name, barcode, measure_unit, category_id, supplier_id, supply_price, retail_price, markup_percentage, amount, is_active, product_type, tax_type, retail_sales_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, true, 'retail', 'no_tax', true)
       RETURNING id`,
      [salonId, template.name, template.barcode, template.measure_unit, template.category_id, template.supplier_id, template.supply_price, template.retail_price, template.markup_percentage]
    );
    return rows[0];
  },

  async executeTransfer(client: any, sourceProductId: string, destProductId: string, quantity: number): Promise<void> {
    await client.query(`UPDATE products SET amount = amount - $1, updated_at = NOW() WHERE id = $2`, [quantity, sourceProductId]);
    await client.query(`UPDATE products SET amount = amount + $1, updated_at = NOW() WHERE id = $2`, [quantity, destProductId]);
  },

  async recordTransfer(branchOwnerId: string, params: {
    source_salon_id: string; dest_salon_id: string; source_product_id: string; dest_product_id: string;
    product_name: string; quantity: number; reason: string | null; status: "pending" | "completed";
  }) {
    const { rows } = await pool.query(
      `INSERT INTO branch_stock_transfers (branch_owner_id, source_salon_id, dest_salon_id, source_product_id, dest_product_id, product_name, quantity, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [branchOwnerId, params.source_salon_id, params.dest_salon_id, params.source_product_id, params.dest_product_id, params.product_name, params.quantity, params.reason, params.status]
    );
    return rows[0];
  },

  async findTransfer(id: string, branchOwnerId: string) {
    const { rows } = await pool.query(
      `SELECT * FROM branch_stock_transfers WHERE id = $1 AND branch_owner_id = $2`,
      [id, branchOwnerId]
    );
    return rows[0] ?? null;
  },

  async setTransferStatus(id: string, status: "completed" | "cancelled") {
    const { rows } = await pool.query(
      `UPDATE branch_stock_transfers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return rows[0];
  },

  async listTransfers(branchOwnerId: string, status?: string) {
    const values: unknown[] = [branchOwnerId];
    let where = "t.branch_owner_id = $1";
    if (status) { values.push(status); where += ` AND t.status = $${values.length}`; }
    const { rows } = await pool.query(
      `SELECT
         t.*,
         COALESCE(ss.business_name, ss.slug, 'Unnamed') AS source_salon_name,
         COALESCE(ds.business_name, ds.slug, 'Unnamed') AS dest_salon_name
       FROM branch_stock_transfers t
       JOIN salons ss ON ss.id = t.source_salon_id
       JOIN salons ds ON ds.id = t.dest_salon_id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT 100`,
      values
    );
    return rows;
  },

  // ── Inventory rollup (KPIs, branch overview, low stock, categories) ──────────

  async getBranchOverview(branchOwnerId: string) {
    const { rows } = await pool.query(
      `SELECT
         s.id AS salon_id,
         COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
         COUNT(p.id)::int AS product_count,
         COALESCE(SUM(p.amount * COALESCE(p.retail_price, p.supply_price, 0)), 0)::numeric AS stock_value
       FROM branch_owner_salons bos
       JOIN salons s ON s.id = bos.salon_id
       LEFT JOIN products p ON p.salon_id = s.id AND p.is_active = true
       WHERE bos.branch_owner_id = $1
       GROUP BY s.id, s.business_name, s.slug
       ORDER BY salon_name ASC`,
      [branchOwnerId]
    );
    return rows;
  },

  async getInventorySummary(branchOwnerId: string) {
    const { rows } = await pool.query(
      `SELECT
         COUNT(p.id)::int AS total_products,
         COALESCE(SUM(p.amount * COALESCE(p.retail_price, p.supply_price, 0)), 0)::numeric AS total_stock_value,
         COUNT(p.id) FILTER (WHERE p.qty_alert IS NOT NULL AND p.amount <= p.qty_alert)::int AS low_stock_count
       FROM branch_owner_salons bos
       JOIN products p ON p.salon_id = bos.salon_id AND p.is_active = true
       WHERE bos.branch_owner_id = $1`,
      [branchOwnerId]
    );
    const { rows: pendingRows } = await pool.query(
      `SELECT COUNT(*)::int AS pending_count FROM branch_stock_transfers WHERE branch_owner_id = $1 AND status = 'pending'`,
      [branchOwnerId]
    );
    return { ...rows[0], pending_transfers_count: pendingRows[0]?.pending_count ?? 0 };
  },

  async getLowStockAlerts(branchOwnerId: string) {
    const { rows } = await pool.query(
      `SELECT
         p.id AS product_id, p.name AS product_name, p.amount, p.qty_alert,
         COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
       FROM branch_owner_salons bos
       JOIN salons s ON s.id = bos.salon_id
       JOIN products p ON p.salon_id = s.id AND p.is_active = true
       WHERE bos.branch_owner_id = $1 AND p.qty_alert IS NOT NULL AND p.amount <= p.qty_alert
       ORDER BY p.amount ASC
       LIMIT 50`,
      [branchOwnerId]
    );
    return rows;
  },

  // Categories are salon-scoped (own row per salon) just like products, so
  // rolling them up across a branch owner's salons groups by category NAME
  // — same approach as the product barcode/name matching for transfers.
  async getCategoryBreakdown(branchOwnerId: string) {
    const { rows } = await pool.query(
      `SELECT c.name AS category_name, COUNT(p.id)::int AS product_count
       FROM branch_owner_salons bos
       JOIN products p ON p.salon_id = bos.salon_id AND p.is_active = true
       JOIN categories c ON c.id = p.category_id
       WHERE bos.branch_owner_id = $1
       GROUP BY c.name
       ORDER BY product_count DESC`,
      [branchOwnerId]
    );
    return rows;
  },

  async getProductsByCategory(branchOwnerId: string, categoryName: string) {
    const { rows } = await pool.query(
      `SELECT
         p.id, p.name, p.amount, p.measure_unit,
         COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
       FROM branch_owner_salons bos
       JOIN salons s ON s.id = bos.salon_id
       JOIN products p ON p.salon_id = s.id AND p.is_active = true
       JOIN categories c ON c.id = p.category_id
       WHERE bos.branch_owner_id = $1 AND c.name = $2
       ORDER BY s.business_name ASC, p.name ASC`,
      [branchOwnerId, categoryName]
    );
    return rows;
  },

  async ensureTransferTable(): Promise<void> {
    await safeQuery(() =>
      pool.query(`
        CREATE TABLE IF NOT EXISTS branch_stock_transfers (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          branch_owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_salon_id   UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
          dest_salon_id     UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
          source_product_id UUID NOT NULL,
          dest_product_id   UUID NOT NULL,
          product_name      TEXT NOT NULL,
          quantity          NUMERIC NOT NULL,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (quantity > 0),
          CHECK (source_salon_id != dest_salon_id)
        );
      `)
    );
    // Additive columns for salons whose table was created before this pass
    // (matches this repo's convention: ALTER ... ADD COLUMN IF NOT EXISTS
    // rather than a formal migration, since no migration runner is wired up).
    await safeQuery(() =>
      pool.query(`ALTER TABLE branch_stock_transfers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`)
    );
    await safeQuery(() =>
      pool.query(`ALTER TABLE branch_stock_transfers ADD COLUMN IF NOT EXISTS reason TEXT;`)
    );
    await safeQuery(() =>
      pool.query(`ALTER TABLE branch_stock_transfers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`)
    );
    await safeQuery(() =>
      pool.query(`CREATE INDEX IF NOT EXISTS idx_branch_stock_transfers_owner ON branch_stock_transfers(branch_owner_id);`)
    );
    await safeQuery(() =>
      pool.query(`CREATE INDEX IF NOT EXISTS idx_branch_stock_transfers_status ON branch_stock_transfers(status);`)
    );
  },

  async ensureTable(): Promise<void> {
    await safeQuery(() =>
      pool.query(`
        CREATE TABLE IF NOT EXISTS branch_owner_salons (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          branch_owner_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          salon_id         UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
          assigned_by      UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (branch_owner_id, salon_id)
        );
      `),
    );
    await safeQuery(() =>
      pool.query(`CREATE INDEX IF NOT EXISTS idx_branch_owner_salons_owner ON branch_owner_salons(branch_owner_id);`),
    );
    await safeQuery(() =>
      pool.query(`CREATE INDEX IF NOT EXISTS idx_branch_owner_salons_salon ON branch_owner_salons(salon_id);`),
    );
  },

};

export async function ensureBranchOwnerTables(): Promise<void> {
  await branchOwnerRepository.ensureTable();
  await branchOwnerRepository.ensureTransferTable();
}
