import pool from '../../config/database';
import {
  CouponDesign,
  CreateCouponDesignBody,
  ListCouponDesignsQuery,
  UpdateCouponDesignBody,
} from './coupon-designs.types';

// Listing must never parse `doc` — it can be tens of KB per row and the gallery
// only needs the card metadata. Every list query selects this column set
// explicitly instead of SELECT *.
const LIST_COLUMNS = `
  id, salon_id, name, kind, status, preset, width_px, height_px,
  thumbnail_url, coupon_id, tags, created_by, created_at, updated_at
`;

export const couponDesignsRepository = {
  /**
   * A salon's own designs, plus — when asking for templates — the global
   * SalonOx starter templates (salon_id IS NULL), which every salon can see
   * and fork. Mirrors couponsRepository.findByCodeForSalon()'s "own first,
   * then global" precedence.
   */
  async list(salonId: string, q: ListCouponDesignsQuery = {}): Promise<Omit<CouponDesign, 'doc'>[]> {
    const kind = q.kind ?? 'design';
    const values: unknown[] = [salonId, kind];
    const where: string[] = [
      kind === 'template' ? `(d.salon_id = $1 OR d.salon_id IS NULL)` : `d.salon_id = $1`,
      `d.kind = $2`,
    ];

    if (q.status) {
      values.push(q.status);
      where.push(`d.status = $${values.length}`);
    } else {
      // Archived designs are hidden unless explicitly asked for — they're the
      // "deleted but recoverable" state, not something to browse past.
      where.push(`d.status <> 'archived'`);
    }
    if (q.search) {
      values.push(`%${q.search}%`);
      where.push(`d.name ILIKE $${values.length}`);
    }

    const { rows } = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM coupon_designs d
       WHERE ${where.join(' AND ')}
       ORDER BY d.salon_id NULLS LAST, d.updated_at DESC`,
      values,
    );
    return rows;
  },

  /** Full row including `doc` — only used when actually opening the editor. */
  async findById(id: string, salonId: string): Promise<CouponDesign | null> {
    const { rows } = await pool.query(
      `SELECT * FROM coupon_designs
       WHERE id = $1 AND (salon_id = $2 OR salon_id IS NULL)`,
      [id, salonId],
    );
    return rows[0] ?? null;
  },

  async create(body: CreateCouponDesignBody, salonId: string, userId: string | null): Promise<CouponDesign> {
    const { rows } = await pool.query(
      `INSERT INTO coupon_designs
         (salon_id, name, kind, status, preset, width_px, height_px, doc,
          thumbnail_url, coupon_id, tags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
       RETURNING *`,
      [
        salonId,
        body.name?.trim() || 'Untitled design',
        body.kind ?? 'design',
        body.status ?? 'draft',
        body.preset ?? 'coupon_card',
        body.width_px,
        body.height_px,
        JSON.stringify(body.doc ?? {}),
        body.thumbnail_url ?? null,
        body.coupon_id ?? null,
        body.tags ?? [],
        userId,
      ],
    );
    return rows[0];
  },

  async update(id: string, patch: UpdateCouponDesignBody, salonId: string): Promise<CouponDesign | null> {
    const set: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, val: unknown, cast = '') => {
      values.push(val);
      set.push(`${col} = $${values.length}${cast}`);
    };

    if (patch.name !== undefined) add('name', patch.name.trim() || 'Untitled design');
    if (patch.kind !== undefined) add('kind', patch.kind);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.preset !== undefined) add('preset', patch.preset);
    if (patch.width_px !== undefined) add('width_px', patch.width_px);
    if (patch.height_px !== undefined) add('height_px', patch.height_px);
    if (patch.doc !== undefined) add('doc', JSON.stringify(patch.doc), '::jsonb');
    if (patch.thumbnail_url !== undefined) add('thumbnail_url', patch.thumbnail_url);
    if (patch.coupon_id !== undefined) add('coupon_id', patch.coupon_id);
    if (patch.tags !== undefined) add('tags', patch.tags);

    if (set.length === 0) return this.findById(id, salonId);

    set.push('updated_at = NOW()');
    values.push(id, salonId);

    // salon_id = $n (not "OR IS NULL") on purpose: a salon may READ a global
    // starter template but must never be able to edit it in place. Editing one
    // goes through duplicate() first.
    const { rows } = await pool.query(
      `UPDATE coupon_designs SET ${set.join(', ')}
       WHERE id = $${values.length - 1} AND salon_id = $${values.length}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  },

  /**
   * Copies any design the salon can see — including a global starter template —
   * into a new row owned by that salon. This is how a template becomes editable.
   */
  async duplicate(id: string, salonId: string, userId: string | null, name?: string): Promise<CouponDesign | null> {
    const { rows } = await pool.query(
      `INSERT INTO coupon_designs
         (salon_id, name, kind, status, preset, width_px, height_px, doc,
          thumbnail_url, coupon_id, tags, created_by)
       SELECT $2,
              COALESCE($3, src.name || ' (copy)'),
              'design', 'draft', src.preset, src.width_px, src.height_px, src.doc,
              src.thumbnail_url, src.coupon_id, src.tags, $4
       FROM coupon_designs src
       WHERE src.id = $1 AND (src.salon_id = $2 OR src.salon_id IS NULL)
       RETURNING *`,
      [id, salonId, name?.trim() || null, userId],
    );
    return rows[0] ?? null;
  },

  async remove(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM coupon_designs WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return (rowCount ?? 0) > 0;
  },
};
