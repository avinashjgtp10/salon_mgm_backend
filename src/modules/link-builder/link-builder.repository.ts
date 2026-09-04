import pool from "../../config/database";
import { SavedLink, SaveLinkBody } from "./link-builder.types";

export const linkBuilderRepository = {
    async list(salonId: string): Promise<SavedLink[]> {
        const { rows } = await pool.query(
            `SELECT * FROM marketplace_saved_links WHERE salon_id = $1 ORDER BY created_at DESC`,
            [salonId]
        );
        return rows;
    },

    async create(salonId: string, data: SaveLinkBody): Promise<SavedLink> {
        const { rows } = await pool.query(
            `INSERT INTO marketplace_saved_links (salon_id, label, booking_url, link_type, service_id, staff_id)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [salonId, data.label, data.bookingUrl, data.type, data.serviceId ?? null, data.staffId ?? null]
        );
        return rows[0];
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM marketplace_saved_links WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },
};
