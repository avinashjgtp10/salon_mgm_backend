import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import type {
  PackageTemplate,
  CreatePackageTemplateDTO,
  UpdatePackageTemplateDTO,
} from "./package-templates.types";

// ── DB bootstrap (idempotent) ─────────────────────────────────────────────────

export async function ensurePackageTemplateTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_templates (
      id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id       UUID          NOT NULL,
      name           VARCHAR(255)  NOT NULL,
      expiry_months  INTEGER       DEFAULT NULL,
      never_expires  BOOLEAN       NOT NULL DEFAULT false,
      base_price     DECIMAL(10,2) NOT NULL DEFAULT 0,
      gst_percentage DECIMAL(5,2)  NOT NULL DEFAULT 0,
      discount       DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(50)   NOT NULL DEFAULT 'cash',
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS package_template_services (
      id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id    UUID          NOT NULL REFERENCES package_templates(id) ON DELETE CASCADE,
      service_name   VARCHAR(255)  NOT NULL,
      total_sessions INTEGER       NOT NULL DEFAULT 1,
      price          DECIMAL(10,2) NOT NULL DEFAULT 0
    );
  `);
}

// ── Mapper ────────────────────────────────────────────────────────────────────

function toTemplate(row: any, services: any[]): PackageTemplate {
  return {
    id:            row.id,
    salonId:       row.salon_id,
    name:          row.name,
    expiryMonths:  row.expiry_months,
    neverExpires:  row.never_expires,
    basePrice:     parseFloat(row.base_price),
    gstPercentage: parseFloat(row.gst_percentage),
    discount:      parseFloat(row.discount),
    paymentMethod: row.payment_method,
    createdAt:     new Date(row.created_at).toISOString(),
    services: services.map(s => ({
      id:            s.id,
      templateId:    s.template_id,
      serviceName:   s.service_name,
      totalSessions: s.total_sessions,
      price:         parseFloat(s.price),
    })),
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export const packageTemplatesRepository = {

  async list(salonId: string): Promise<PackageTemplate[]> {
    const { rows } = await pool.query(
      `SELECT * FROM package_templates WHERE salon_id = $1 ORDER BY created_at DESC`,
      [salonId],
    );
    if (!rows.length) return [];

    const ids = rows.map(r => r.id);
    const { rows: svcRows } = await pool.query(
      `SELECT * FROM package_template_services WHERE template_id = ANY($1::uuid[]) ORDER BY id`,
      [ids],
    );

    return rows.map(row => toTemplate(row, svcRows.filter(s => s.template_id === row.id)));
  },

  async findById(id: string, salonId: string): Promise<PackageTemplate | null> {
    const { rows } = await pool.query(
      `SELECT * FROM package_templates WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    if (!rows.length) return null;
    const { rows: svcRows } = await pool.query(
      `SELECT * FROM package_template_services WHERE template_id = $1 ORDER BY id`,
      [id],
    );
    return toTemplate(rows[0], svcRows);
  },

  async create(salonId: string, dto: CreatePackageTemplateDTO): Promise<PackageTemplate> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = uuidv4();

      await client.query(
        `INSERT INTO package_templates
          (id, salon_id, name, expiry_months, never_expires, base_price, gst_percentage, discount, payment_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id, salonId, dto.name,
          dto.neverExpires ? null : (dto.expiryMonths ?? null),
          dto.neverExpires ?? false,
          dto.basePrice,
          dto.gstPercentage ?? 0,
          dto.discount ?? 0,
          dto.paymentMethod ?? "cash",
        ],
      );

      for (const svc of dto.services ?? []) {
        await client.query(
          `INSERT INTO package_template_services (id, template_id, service_name, total_sessions, price)
           VALUES ($1,$2,$3,$4,$5)`,
          [uuidv4(), id, svc.serviceName, svc.totalSessions, svc.price],
        );
      }

      const { rows }    = await client.query(`SELECT * FROM package_templates WHERE id = $1`, [id]);
      const { rows: sv} = await client.query(`SELECT * FROM package_template_services WHERE template_id = $1`, [id]);
      await client.query("COMMIT");
      return toTemplate(rows[0], sv);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id: string, salonId: string, dto: UpdatePackageTemplateDTO): Promise<PackageTemplate | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const sets: string[] = [];
      const vals: any[]    = [];
      let   idx = 1;

      if (dto.name           !== undefined) { sets.push(`name = $${idx++}`);           vals.push(dto.name); }
      if (dto.neverExpires   !== undefined) { sets.push(`never_expires = $${idx++}`);  vals.push(dto.neverExpires); }
      if (dto.expiryMonths   !== undefined) { sets.push(`expiry_months = $${idx++}`);  vals.push(dto.neverExpires ? null : dto.expiryMonths); }
      if (dto.basePrice      !== undefined) { sets.push(`base_price = $${idx++}`);     vals.push(dto.basePrice); }
      if (dto.gstPercentage  !== undefined) { sets.push(`gst_percentage = $${idx++}`); vals.push(dto.gstPercentage); }
      if (dto.discount       !== undefined) { sets.push(`discount = $${idx++}`);       vals.push(dto.discount); }
      if (dto.paymentMethod  !== undefined) { sets.push(`payment_method = $${idx++}`); vals.push(dto.paymentMethod); }

      if (sets.length > 0) {
        vals.push(id, salonId);
        await client.query(
          `UPDATE package_templates SET ${sets.join(", ")} WHERE id = $${idx++} AND salon_id = $${idx++}`,
          vals,
        );
      }

      if (dto.services !== undefined) {
        await client.query(`DELETE FROM package_template_services WHERE template_id = $1`, [id]);
        for (const svc of dto.services) {
          await client.query(
            `INSERT INTO package_template_services (id, template_id, service_name, total_sessions, price)
             VALUES ($1,$2,$3,$4,$5)`,
            [uuidv4(), id, svc.serviceName, svc.totalSessions, svc.price],
          );
        }
      }

      const { rows }    = await client.query(`SELECT * FROM package_templates WHERE id = $1`, [id]);
      const { rows: sv} = await client.query(`SELECT * FROM package_template_services WHERE template_id = $1`, [id]);
      await client.query("COMMIT");
      return rows.length ? toTemplate(rows[0], sv) : null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM package_templates WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return (rowCount ?? 0) > 0;
  },
};
