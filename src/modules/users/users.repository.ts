
import pool from "../../config/database";


export const usersRepo = {
  async findById(id: string) {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1 LIMIT 1`, [id]);
    return rows[0] || null;
  },

  // `sessionSalonId` (the salon_id off the caller's own JWT) disambiguates
  // which staff row to use when this user has more than one — e.g. a test
  // account added as staff to multiple salons, or a leftover duplicate row.
  // Without it, the plain `LEFT JOIN staff s ON s.user_id = u.id` + `LIMIT 1`
  // below picked an arbitrary, unordered row: /users/me could silently
  // resolve permissions against a completely different salon's staff record
  // (or a stale one with no role_id at all) than the one actually being
  // configured, while every other page — all correctly salon_id-scoped —
  // kept showing the right data, making it look like nothing was wrong.
  async findByIdWithStaffPermissions(id: string, sessionSalonId?: string | null) {
    const { rows } = await pool.query(
      `SELECT u.*, s.custom_permissions, s.salon_id AS staff_salon_id, s.role_id, r.name AS role_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM staff st
         WHERE st.user_id = u.id
         -- Matching salon first, then an ACTIVE row over an inactive one —
         -- a deactivated leftover duplicate (e.g. an old invite superseded
         -- by a new staff record) must never outrank the real, currently-
         -- active one just for having a later created_at — then most
         -- recently created as the final tiebreak.
         ORDER BY (st.salon_id = $2) DESC, st.is_active DESC, st.created_at DESC
         LIMIT 1
       ) s ON true
       LEFT JOIN roles r ON r.id = s.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [id, sessionSalonId ?? null]
    );
    return rows[0] || null;
  },

  async findAll() {
    const { rows } = await pool.query(
      `SELECT * FROM users ORDER BY created_at DESC`
    );
    return rows;
  },

  async updateById(id: string, updates: Record<string, any>) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return this.findById(id);

    // Build dynamic update query
    const setClause = keys.map((k, i) => `"${k}"=$${i + 2}`).join(", ");
    const values = keys.map((k) => updates[k]);

    const { rows } = await pool.query(
      `UPDATE users
       SET ${setClause}, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [id, ...values]
    );

    return rows[0] || null;
  },

  async deleteById(id: string) {
  const result = await pool.query(`DELETE FROM users WHERE id=$1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

};
