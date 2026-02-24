import pool from "../../config/database";
import { CreateCategoryBody, ServiceCategory, UpdateCategoryBody } from "./categories.types";

export const categoriesRepository = {
  async findByIdInSalon(id: string, salonId: string): Promise<ServiceCategory | null> {
    const { rows } = await pool.query(
      `SELECT * FROM service_categories WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    );
    return rows[0] || null;
  },

  async listBySalonId(salonId: string): Promise<ServiceCategory[]> {
    const { rows } = await pool.query(
      `SELECT *
       FROM service_categories
       WHERE salon_id = $1
       ORDER BY display_order ASC, created_at DESC`,
      [salonId]
    );
    return rows;
  },

  async create(salonId: string, data: CreateCategoryBody): Promise<ServiceCategory> {
    const { rows } = await pool.query(
      `INSERT INTO service_categories (salon_id, name, description, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        salonId,
        data.name.trim(),
        data.description ?? null,
        data.display_order ?? 0,
        data.is_active ?? true,
      ]
    );
    return rows[0];
  },

  async update(id: string, salonId: string, patch: UpdateCategoryBody): Promise<ServiceCategory | null> {
    const allowed: (keyof UpdateCategoryBody)[] = ["name", "description", "display_order", "is_active"];

    const entries = allowed
      .filter((k) => patch[k] !== undefined)
      .map((k) => [k, patch[k]] as const);

    if (entries.length === 0) {
      return this.findByIdInSalon(id, salonId);
    }

    const setParts: string[] = [];
    const values: any[] = [];

    entries.forEach(([key, value], idx) => {
      if (key === "name" && typeof value === "string") value = value.trim();
      setParts.push(`${String(key)} = $${idx + 1}`);
      values.push(value);
    });

    values.push(id);
    values.push(salonId);

    const { rows } = await pool.query(
      `UPDATE service_categories
       SET ${setParts.join(", ")}
       WHERE id = $${values.length - 1} AND salon_id = $${values.length}
       RETURNING *`,
      values
    );

    return rows[0] || null;
  },

  async remove(id: string, salonId: string): Promise<{ id: string } | null> {
    const { rows } = await pool.query(
      `DELETE FROM service_categories
       WHERE id = $1 AND salon_id = $2
       RETURNING id`,
      [id, salonId]
    );
    return rows[0] || null;
  },
};