import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import type {
  Package,
  PackageRow,
  PackageOfferRow,
  CreatePackageDTO,
  UpdatePackageDTO,
  PackagesListQuery,
  DiscountType,
} from "./packages.types";

// ── Shared SELECT ────────────────────────────────────────────────────────────

const SELECT_FULL = `
  SELECT
    p.*,
    COALESCE(
      array_agg(DISTINCT ps.service_id) FILTER (WHERE ps.service_id IS NOT NULL),
      '{}'
    ) AS service_ids,
    COALESCE(
      json_agg(
        json_build_object(
          'id',             po.id,
          'offerName',      po.offer_name,
          'couponCode',     po.coupon_code,
          'discountAmount', po.discount_amount,
          'discountType',   po.discount_type,
          'startDate',      po.start_date,
          'endDate',        po.end_date,
          'minimumOrder',   po.minimum_order,
          'isActive',       po.is_active
        )
      ) FILTER (WHERE po.id IS NOT NULL),
      '[]'
    ) AS offers
  FROM packages p
  LEFT JOIN package_services ps ON ps.package_id = p.id
  LEFT JOIN package_offers   po ON po.package_id = p.id
`;

// ── Row → Domain mapper ──────────────────────────────────────────────────────

function toPackage(row: PackageRow): Package {
  return {
    id:              row.id,
    salonId:         row.salon_id,
    name:            row.name,
    slug:            row.slug,
    description:     row.description ?? undefined,
    basePrice:       parseFloat(row.base_price),
    discountValue:   parseFloat(row.discount_value),
    discountType:    row.discount_type as DiscountType,
    durationMinutes: row.duration_minutes,
    category:        row.category,
    priority:        row.priority,
    serviceIds:      row.service_ids ?? [],
    offers: (row.offers ?? []).map((o: PackageOfferRow) => ({
      id:             o.id,
      offerName:      o.offerName,
      couponCode:     o.couponCode,
      discountAmount: parseFloat(o.discountAmount),
      discountType:   o.discountType as DiscountType,
      startDate:      o.startDate ?? null,
      endDate:        o.endDate ?? null,
      minimumOrder:   parseFloat(o.minimumOrder),
      isActive:       o.isActive,
    })),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

// ── Repository ───────────────────────────────────────────────────────────────

export const packagesRepository = {

  async list(query: PackagesListQuery): Promise<{ items: Package[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    // Always scope to salon first
    conditions.push(`p.salon_id = $${idx++}`);
    values.push(query.salonId);

    if (query.search) {
      conditions.push(`p.name ILIKE $${idx++}`);
      values.push(`%${query.search}%`);
    }
    if (query.category) {
      conditions.push(`p.category = $${idx++}`);
      values.push(query.category);
    }

    const where  = `WHERE ${conditions.join(" AND ")}`;
    const page   = Math.max(1, query.page  ?? 1);
    const limit  = Math.min(100, query.limit ?? 20);
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `${SELECT_FULL} ${where} GROUP BY p.id ORDER BY p.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM packages p ${where}`,
      values
    );

    return {
      items: rows.map(toPackage),
      total: parseInt(countRes.rows[0].count, 10),
    };
  },

  async findById(id: string, salonId: string): Promise<Package | null> {
    const { rows } = await pool.query(
      `${SELECT_FULL} WHERE p.id = $1 AND p.salon_id = $2 GROUP BY p.id`,
      [id, salonId]
    );
    return rows.length ? toPackage(rows[0]) : null;
  },

  async create(data: CreatePackageDTO): Promise<Package> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const pkgId = uuidv4();

      await client.query(
        `INSERT INTO packages
          (id, salon_id, name, slug, description, base_price, discount_value,
           discount_type, duration_minutes, category, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          pkgId,
          data.salonId,
          data.name,
          data.slug,
          data.description ?? null,
          data.basePrice,
          data.discountValue   ?? 0,
          data.discountType    ?? "percentage",
          data.durationMinutes,
          data.category,
          data.priority        ?? 5,
        ]
      );

      for (const serviceId of (data.serviceIds ?? [])) {
        await client.query(
          `INSERT INTO package_services (package_id, service_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [pkgId, serviceId]
        );
      }

      for (const offer of (data.offers ?? [])) {
        await client.query(
          `INSERT INTO package_offers
            (id, package_id, offer_name, coupon_code, discount_amount,
             discount_type, start_date, end_date, minimum_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            uuidv4(),
            pkgId,
            offer.offerName      ?? "",
            offer.couponCode     ?? "",
            offer.discountAmount ?? 0,
            offer.discountType   ?? "percentage",
            offer.startDate      ?? null,
            offer.endDate        ?? null,
            offer.minimumOrder   ?? 0,
            offer.isActive       ?? true,
          ]
        );
      }

      const { rows } = await client.query(
        `${SELECT_FULL} WHERE p.id = $1 GROUP BY p.id`,
        [pkgId]
      );

      await client.query("COMMIT");
      return toPackage(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, salonId: string, data: UpdatePackageDTO): Promise<Package | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const colMap: Record<string, string> = {
        name:            "name",
        slug:            "slug",
        description:     "description",
        basePrice:       "base_price",
        discountValue:   "discount_value",
        discountType:    "discount_type",
        durationMinutes: "duration_minutes",
        category:        "category",
        priority:        "priority",
      };

      const fields: string[] = [];
      const values: any[]    = [];
      let idx = 1;

      for (const [key, col] of Object.entries(colMap)) {
        if (key in data) {
          fields.push(`${col} = $${idx++}`);
          values.push((data as any)[key] ?? null);
        }
      }

      if (fields.length > 0) {
        values.push(id);
        values.push(salonId);
        const res = await client.query(
          `UPDATE packages SET ${fields.join(", ")}, updated_at = NOW()
           WHERE id = $${idx} AND salon_id = $${idx + 1} RETURNING id`,
          values
        );
        if (res.rowCount === 0) return null;
      }

      if (data.serviceIds !== undefined) {
        await client.query(`DELETE FROM package_services WHERE package_id = $1`, [id]);
        for (const serviceId of data.serviceIds) {
          await client.query(
            `INSERT INTO package_services (package_id, service_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, serviceId]
          );
        }
      }

      if (data.offers !== undefined) {
        await client.query(`DELETE FROM package_offers WHERE package_id = $1`, [id]);
        for (const offer of data.offers) {
          await client.query(
            `INSERT INTO package_offers
              (id, package_id, offer_name, coupon_code, discount_amount,
               discount_type, start_date, end_date, minimum_order, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              uuidv4(),
              id,
              offer.offerName      ?? "",
              offer.couponCode     ?? "",
              offer.discountAmount ?? 0,
              offer.discountType   ?? "percentage",
              offer.startDate      ?? null,
              offer.endDate        ?? null,
              offer.minimumOrder   ?? 0,
              offer.isActive       ?? true,
            ]
          );
        }
      }

      const { rows } = await client.query(
        `${SELECT_FULL} WHERE p.id = $1 AND p.salon_id = $2 GROUP BY p.id`,
        [id, salonId]
      );

      await client.query("COMMIT");
      return rows.length ? toPackage(rows[0]) : null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM packages WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    );
    return (rowCount ?? 0) > 0;
  },

  async listForExport(query: PackagesListQuery): Promise<Package[]> {
    const { items } = await this.list({ ...query, page: 1, limit: 10000 });
    return items;
  },
};
