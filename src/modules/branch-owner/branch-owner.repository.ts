import pool, { safeQuery } from "../../config/database";

export const branchOwnerRepository = {

  async getMySalons(branchOwnerId: string) {
    const { rows } = await pool.query(`
      SELECT
        s.id,
        COALESCE(s.business_name, s.slug, 'Unnamed')                                    AS name,
        u.email                                                                           AS owner_email,
        TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,'')))                         AS owner_name,
        CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END                         AS status,
        s.created_at
      FROM branch_owner_salons bos
      JOIN salons s ON s.id = bos.salon_id
      LEFT JOIN users u ON u.id = s.owner_id
      WHERE bos.branch_owner_id = $1
      ORDER BY s.created_at DESC
    `, [branchOwnerId]);
    return rows;
  },

  async isSalonAssignedToBranchOwner(branchOwnerId: string, salonId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM branch_owner_salons WHERE branch_owner_id = $1 AND salon_id = $2 LIMIT 1`,
      [branchOwnerId, salonId]
    );
    return rows.length > 0;
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
