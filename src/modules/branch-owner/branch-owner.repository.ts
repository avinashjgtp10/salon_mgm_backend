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
}
