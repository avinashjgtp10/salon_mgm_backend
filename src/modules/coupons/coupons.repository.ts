import pool from '../../config/database';
import { Coupon, CreateCouponBody, UpdateCouponBody } from './coupons.types';

export const couponsRepository = {

  async findByCode(code: string): Promise<Coupon | null> {
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)`,
      [code.trim()]
    );
    return rows[0] || null;
  },

  // Prefers this salon's own coupon over a same-named global one, and never
  // returns another salon's private coupon — findByCode() alone is unscoped
  // and would let one salon's coupon code redeem at a different salon.
  async findByCodeForSalon(code: string, salonId?: string): Promise<Coupon | null> {
    if (!salonId) return this.findByCode(code);
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) AND (salon_id = $2 OR salon_id IS NULL)
       ORDER BY salon_id NULLS LAST LIMIT 1`,
      [code.trim(), salonId]
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

  // ---------------- MANAGEMENT (Settings → Coupons) ----------------
  // Scoped strictly to this salon's own coupons — never the global
  // (salon_id IS NULL) ones, which no single salon's UI should edit/delete.
  async listOwn(salonId: string): Promise<Coupon[]> {
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE salon_id = $1 ORDER BY created_at DESC`,
      [salonId]
    );
    return rows;
  },

  async findByIdOwn(id: string, salonId: string): Promise<Coupon | null> {
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    );
    return rows[0] || null;
  },

  async findByCodeOwn(code: string, salonId: string): Promise<Coupon | null> {
    const { rows } = await pool.query(
      `SELECT * FROM coupons WHERE salon_id = $1 AND UPPER(code) = UPPER($2)`,
      [salonId, code.trim()]
    );
    return rows[0] || null;
  },

  // Checks a whole batch of candidate codes in one round trip — used by bulk
  // creation instead of one findByCodeOwn() call per candidate, which was
  // timing out for larger batches (N sequential round trips over a remote DB).
  async findExistingCodes(codes: string[], salonId: string): Promise<string[]> {
    if (codes.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT UPPER(code) AS code FROM coupons WHERE salon_id = $1 AND UPPER(code) = ANY($2::text[])`,
      [salonId, codes.map((c) => c.toUpperCase())]
    );
    return rows.map((r) => r.code);
  },

  async create(body: CreateCouponBody, salonId: string): Promise<Coupon> {
    const { rows } = await pool.query(
      `INSERT INTO coupons (salon_id, code, type, value, min_order_amount, max_uses, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        salonId,
        body.code.trim().toUpperCase(),
        body.type,
        body.value,
        body.min_order_amount ?? 0,
        body.max_uses ?? null,
        body.expires_at,
        body.is_active ?? true,
      ]
    );
    return rows[0];
  },

  async update(id: string, patch: UpdateCouponBody, salonId: string): Promise<Coupon | null> {
    const setParts: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const add = (col: string, val: any) => {
      setParts.push(`${col} = $${idx++}`);
      values.push(val);
    };

    if (patch.code !== undefined) add('code', patch.code.trim().toUpperCase());
    if (patch.type !== undefined) add('type', patch.type);
    if (patch.value !== undefined) add('value', patch.value);
    if (patch.min_order_amount !== undefined) add('min_order_amount', patch.min_order_amount);
    if (patch.max_uses !== undefined) add('max_uses', patch.max_uses);
    if (patch.expires_at !== undefined) add('expires_at', patch.expires_at);
    if (patch.is_active !== undefined) add('is_active', patch.is_active);

    if (setParts.length === 0) {
      return this.findByIdOwn(id, salonId);
    }

    setParts.push('updated_at = NOW()');
    values.push(id, salonId);

    const { rows } = await pool.query(
      `UPDATE coupons SET ${setParts.join(', ')}
       WHERE id = $${idx++} AND salon_id = $${idx}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async remove(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM coupons WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    );
    return (rowCount ?? 0) > 0;
  },

  async removeByBatch(batchId: string, salonId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM coupons WHERE batch_id = $1 AND salon_id = $2`,
      [batchId, salonId]
    );
    return rowCount ?? 0;
  },

  // Bulk create — one INSERT for all N codes rather than N round trips.
  // All rows share the same discount rule and batch_id/batch_label (so the
  // UI can collapse them into one expandable group); only `code` varies per row.
  async createMany(
    codes: string[],
    body: Omit<CreateCouponBody, 'code'>,
    salonId: string,
    batchId: string,
    batchLabel: string,
  ): Promise<Coupon[]> {
    if (codes.length === 0) return [];

    const values: any[] = [];
    const rowsSql = codes.map((code, i) => {
      const base = i * 10;
      values.push(
        salonId,
        code,
        body.type,
        body.value,
        body.min_order_amount ?? 0,
        body.max_uses ?? null,
        body.expires_at,
        body.is_active ?? true,
        batchId,
        batchLabel,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
    }).join(', ');

    const { rows } = await pool.query(
      `INSERT INTO coupons (salon_id, code, type, value, min_order_amount, max_uses, expires_at, is_active, batch_id, batch_label)
       VALUES ${rowsSql}
       RETURNING *`,
      values
    );
    return rows;
  },
};
