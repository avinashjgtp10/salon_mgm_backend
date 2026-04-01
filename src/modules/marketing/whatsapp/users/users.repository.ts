import pool from '../../../../config/database'
import { v4 as uuid } from 'uuid'
import { WAUser } from './users.types'

export const usersRepository = {

  async findBySalonId(salonId: string): Promise<WAUser[]> {
    const { rows } = await pool.query(`
      SELECT id, first_name, last_name, email, role, is_active, created_at
      FROM users
      WHERE salon_id = $1
      ORDER BY created_at DESC
    `, [salonId])
    return rows
  },

  async findById(id: string, salonId: string): Promise<WAUser | null> {
    const { rows } = await pool.query(`
      SELECT id, first_name, last_name, email, role, is_active, created_at
      FROM users
      WHERE id = $1 AND salon_id = $2
    `, [id, salonId])
    return rows[0] || null
  },

  async create(salonId: string, data: {
    first_name:    string
    last_name:     string
    email:         string
    password_hash: string
    role:          string
  }): Promise<WAUser> {
    const { rows } = await pool.query(`
      INSERT INTO users
        (id, salon_id, first_name, last_name, email, password_hash, role, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      RETURNING id, first_name, last_name, email, role, is_active, created_at
    `, [
      uuid(),
      salonId,
      data.first_name,
      data.last_name,
      data.email,
      data.password_hash,
      data.role,
    ])
    return rows[0]
  },

  async update(id: string, salonId: string, updates: Record<string, any>): Promise<WAUser> {
    const keys = Object.keys(updates)
    if (keys.length === 0) return this.findById(id, salonId) as Promise<WAUser>

    const setParts = keys.map((k, i) => `"${k}" = $${i + 3}`)
    const values   = keys.map(k => updates[k])

    const { rows } = await pool.query(`
      UPDATE users
      SET ${setParts.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND salon_id = $2
      RETURNING id, first_name, last_name, email, role, is_active, created_at
    `, [id, salonId, ...values])
    return rows[0]
  },

  async delete(id: string, salonId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    )
    return (result.rowCount ?? 0) > 0
  },
}
