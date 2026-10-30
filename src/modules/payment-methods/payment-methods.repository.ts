import pool from '../../config/database';

export interface SalonPaymentMethod {
  id: string;
  salon_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const paymentMethodsRepository = {
  async list(salonId: string, activeOnly = false): Promise<SalonPaymentMethod[]> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_payment_methods
        WHERE salon_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''}
        ORDER BY created_at ASC`,
      [salonId],
    );
    return rows;
  },

  async findById(id: string, salonId: string): Promise<SalonPaymentMethod | null> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_payment_methods WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return rows[0] ?? null;
  },

  async findByName(salonId: string, name: string): Promise<SalonPaymentMethod | null> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_payment_methods WHERE salon_id = $1 AND LOWER(BTRIM(name)) = LOWER(BTRIM($2))`,
      [salonId, name],
    );
    return rows[0] ?? null;
  },

  async create(salonId: string, name: string, createdBy: string | null): Promise<SalonPaymentMethod> {
    const { rows } = await pool.query(
      `INSERT INTO salon_payment_methods (salon_id, name, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [salonId, name, createdBy],
    );
    return rows[0];
  },

  async update(id: string, salonId: string, data: { name?: string; is_active?: boolean }): Promise<SalonPaymentMethod | null> {
    const { rows } = await pool.query(
      `UPDATE salon_payment_methods SET
         name = COALESCE($3, name),
         is_active = COALESCE($4, is_active),
         updated_at = NOW()
       WHERE id = $1 AND salon_id = $2 RETURNING *`,
      [id, salonId, data.name ?? null, data.is_active ?? null],
    );
    return rows[0] ?? null;
  },
};
