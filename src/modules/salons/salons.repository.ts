import pool from "../../config/database";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";

export const salonsRepository = {
    async findById(id: string): Promise<Salon | null> {
        const { rows } = await pool.query(`SELECT * FROM salons WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async findBySlug(slug: string): Promise<Salon | null> {
        const { rows } = await pool.query(`SELECT * FROM salons WHERE slug = $1`, [slug]);
        return rows[0] || null;
    },

    async findByOwnerId(ownerId: string): Promise<Salon | null> {
        const { rows } = await pool.query(
            `SELECT * FROM salons WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [ownerId]
        );
        return rows[0] || null;
    },

    async listAll(): Promise<Salon[]> {
        const { rows } = await pool.query(`SELECT * FROM salons ORDER BY created_at DESC`);
        return rows;
    },

    async create(ownerId: string, data: CreateSalonBody): Promise<Salon> {
        const { rows } = await pool.query(
            `INSERT INTO salons (
        owner_id, business_name, business_type, slug, description,
        logo_url, banner_url, email, phone, website_url, gst_number, pan_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
            [
                ownerId,
                data.business_name.trim(),
                data.business_type ?? null,
                data.slug ?? null,
                data.description ?? null,
                data.logo_url ?? null,
                data.banner_url ?? null,
                data.email ?? null,
                data.phone ?? null,
                data.website_url ?? null,
                data.gst_number ?? null,
                data.pan_number ?? null,
            ]
        );

        return rows[0];
    },

    async update(id: string, patch: UpdateSalonBody): Promise<Salon> {
        const keys = Object.keys(patch) as (keyof UpdateSalonBody)[];

        // Nothing to update → return current
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM salons WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k, idx) => {
            setParts.push(`${k} = $${idx + 1}`);
            values.push((patch as any)[k]);
        });

        // Always update updated_at
        setParts.push(`updated_at = NOW()`);

        values.push(id);

        const { rows } = await pool.query(
            `UPDATE salons
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );

        return rows[0];
    },
};
