import pool from '../../config/database';
import { Coupon } from './coupons.types';

export const couponsRepository = {

  async findByCode(code: string): Promise<Coupon | null> {
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)`,
      [code.trim()]
    );
    return rows[0] || null;
  },

  async incrementUsed(couponId: string): Promise<void> {
    await pool.query(
      `UPDATE coupons SET used_count = used_count + 1, updated_at = NOW() WHERE id = $1`,
      [couponId]
    );
  },

  async list(salonId?: string): Promise<Coupon[]> {
    if (salonId) {
      const { rows } = await pool.query(
        `SELECT * FROM coupons WHERE (salon_id = $1 OR salon_id IS NULL) AND is_active = TRUE ORDER BY created_at DESC`,
        [salonId]
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE is_active = TRUE ORDER BY created_at DESC`
    );
    return rows;
  },
};
