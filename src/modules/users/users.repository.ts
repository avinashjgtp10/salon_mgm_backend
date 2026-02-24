
import pool from "../../config/database";


export const usersRepo = {
  async findById(id: string) {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1 LIMIT 1`, [id]);
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
