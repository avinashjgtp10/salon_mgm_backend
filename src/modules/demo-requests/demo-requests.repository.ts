import pool from "../../config/database";
import { DemoRequest, DemoRequestStatus } from "./demo-requests.types";

export const demoRequestsRepository = {
    async create(data: {
        name: string; email: string; phone?: string;
        salonName?: string; city?: string; locationsCount?: string;
    }): Promise<DemoRequest> {
        const { rows } = await pool.query(
            `INSERT INTO demo_requests (name, email, phone, salon_name, city, locations_count)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [data.name, data.email, data.phone ?? null, data.salonName ?? null, data.city ?? null, data.locationsCount ?? null],
        );
        return rows[0];
    },

    async list(search?: string): Promise<DemoRequest[]> {
        const searchParam = search ? `%${search}%` : null;
        const { rows } = await pool.query(
            `SELECT * FROM demo_requests
             WHERE ($1::text IS NULL
               OR name       ILIKE $1
               OR email      ILIKE $1
               OR salon_name ILIKE $1
               OR city       ILIKE $1)
             ORDER BY created_at DESC
             LIMIT 500`,
            [searchParam],
        );
        return rows;
    },

    async updateStatus(id: string, status: DemoRequestStatus): Promise<DemoRequest | null> {
        const { rows } = await pool.query(
            `UPDATE demo_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, id],
        );
        return rows[0] || null;
    },
};
