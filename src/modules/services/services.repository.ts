import pool from "../../config/database";
import {
  CreateCategoryBody,
  CreateServiceBody,
  Service,
  ServiceCategory,
  UpdateCategoryBody,
  UpdateServiceBody,
} from "./services.types";

export const servicesRepository = {
  // ---------- Categories ----------
  async createCategory(
    salonId: string,
    body: CreateCategoryBody,
  ): Promise<ServiceCategory> {
    const { rows } = await pool.query(
      `INSERT INTO service_categories (salon_id, name, description, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        salonId,
        body.name.trim(),
        body.description ?? null,
        body.display_order ?? 0,
        body.is_active ?? true,
      ],
    );
    return rows[0];
  },

  async listCategories(salonId: string): Promise<ServiceCategory[]> {
    const { rows } = await pool.query(
      `SELECT * FROM service_categories WHERE salon_id = $1 ORDER BY display_order ASC, created_at DESC`,
      [salonId],
    );
    return rows;
  },

  async findCategoryById(id: string): Promise<ServiceCategory | null> {
    const { rows } = await pool.query(
      `SELECT * FROM service_categories WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  },

  async updateCategory(id: string, patch: UpdateCategoryBody): Promise<ServiceCategory> {
    const keys = Object.keys(patch) as (keyof UpdateCategoryBody)[];

    // If no patch, just return current record (or null safety)
    if (keys.length === 0) {
      const { rows } = await pool.query(
        `SELECT * FROM service_categories WHERE id = $1`,
        [id],
      );
      return rows[0];
    }

    const setParts: string[] = [];
    const values: any[] = [];

    keys.forEach((k, idx) => {
      setParts.push(`${k} = $${idx + 1}`);
      values.push((patch as any)[k]);
    });

    values.push(id);

    const { rows } = await pool.query(
      `UPDATE service_categories
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values,
    );

    return rows[0];
  },

  async deleteCategory(id: string): Promise<{ deleted: boolean }> {
    const result = await pool.query(
      `DELETE FROM service_categories WHERE id = $1`,
      [id],
    );

    const affected = result.rowCount ?? 0; // ✅ FIX
    return { deleted: affected > 0 };
  },

  // ---------- Services ----------
  async createService(salonId: string, body: CreateServiceBody): Promise<Service> {
    const { rows } = await pool.query(
      `INSERT INTO services (
        salon_id, category_id, name, description, duration_minutes,
        price, discounted_price, gender_preference, image_url, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        salonId,
        body.category_id ?? null,
        body.name.trim(),
        body.description ?? null,
        body.duration_minutes,
        body.price,
        body.discounted_price ?? null,
        body.gender_preference ?? null,
        body.image_url ?? null,
        body.is_active ?? true,
      ],
    );

    return rows[0];
  },

  async listServices(salonId: string, categoryId?: string): Promise<Service[]> {
    if (categoryId) {
      const { rows } = await pool.query(
        `SELECT * FROM services WHERE salon_id = $1 AND category_id = $2 ORDER BY created_at DESC`,
        [salonId, categoryId],
      );
      return rows;
    }

    const { rows } = await pool.query(
      `SELECT * FROM services WHERE salon_id = $1 ORDER BY created_at DESC`,
      [salonId],
    );
    return rows;
  },

  async findServiceById(id: string): Promise<Service | null> {
    const { rows } = await pool.query(`SELECT * FROM services WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async updateService(id: string, patch: UpdateServiceBody): Promise<Service> {
    const keys = Object.keys(patch) as (keyof UpdateServiceBody)[];

    if (keys.length === 0) {
      const { rows } = await pool.query(`SELECT * FROM services WHERE id = $1`, [id]);
      return rows[0];
    }

    const setParts: string[] = [];
    const values: any[] = [];

    keys.forEach((k, idx) => {
      setParts.push(`${k} = $${idx + 1}`);
      values.push((patch as any)[k]);
    });

    setParts.push(`updated_at = NOW()`);

    values.push(id);

    const { rows } = await pool.query(
      `UPDATE services
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
      values,
    );

    return rows[0];
  },

  async deleteService(id: string): Promise<{ deleted: boolean }> {
    const result = await pool.query(`DELETE FROM services WHERE id = $1`, [id]);

    const affected = result.rowCount ?? 0; // ✅ FIX
    return { deleted: affected > 0 };
  },

  // ---------- Staff mapping ----------
  async assignStaffToService(staffId: string, serviceId: string) {
    const { rows } = await pool.query(
      `INSERT INTO staff_services (staff_id, service_id)
       VALUES ($1,$2)
       ON CONFLICT (staff_id, service_id) DO NOTHING
       RETURNING *`,
      [staffId, serviceId],
    );
    return rows[0] || null;
  },

  async unassignStaffFromService(staffId: string, serviceId: string) {
    const result = await pool.query(
      `DELETE FROM staff_services WHERE staff_id = $1 AND service_id = $2`,
      [staffId, serviceId],
    );

    const affected = result.rowCount ?? 0; // ✅ FIX
    return { deleted: affected > 0 };
  },

  async listStaffServices(staffId: string): Promise<Service[]> {
    const { rows } = await pool.query(
      `SELECT s.*
       FROM staff_services ss
       JOIN services s ON s.id = ss.service_id
       WHERE ss.staff_id = $1
       ORDER BY ss.created_at DESC`,
      [staffId],
    );
    return rows;
  },
};
