import pool from "../../config/database";

export const bookingsRepository = {
    async findSalonBySlug(slug: string) {
        const { rows } = await pool.query(
            `SELECT s.id, s.slug, s.description, s.city, s.state, s.country,
                    s.logo_url, s.banner_url, s.currency,
                    COALESCE(NULLIF(s.business_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '')) AS business_name,
                    u.phone AS phone,
                    COALESCE(NULLIF(s.email, ''), u.email) AS email,
                    u.address AS address
             FROM salons s
             LEFT JOIN users u ON u.id = s.owner_id
             WHERE s.slug = $1 AND s.is_active = true`,
            [slug]
        );
        return rows[0] || null;
    },

    async findSalonById(salonId: string) {
        const { rows } = await pool.query(
            `SELECT s.id, s.slug, s.description, s.city, s.state, s.country,
                    s.logo_url, s.banner_url, s.currency,
                    COALESCE(NULLIF(s.business_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '')) AS business_name,
                    u.phone AS phone,
                    COALESCE(NULLIF(s.email, ''), u.email) AS email,
                    u.address AS address
             FROM salons s
             LEFT JOIN users u ON u.id = s.owner_id
             WHERE s.id = $1 AND s.is_active = true`,
            [salonId]
        );
        return rows[0] || null;
    },

    async findActiveServices(salonId: string) {
        const { rows } = await pool.query(
            `SELECT s.id, s.name, s.description, s.price, s.price_type,
                    s.duration_minutes AS duration, s.category_id, c.name AS category_name
             FROM services s
             LEFT JOIN service_categories c ON c.id = s.category_id
             WHERE s.salon_id = $1 AND s.is_active = true AND s.online_booking = true
             ORDER BY s.created_at DESC`,
            [salonId]
        );
        return rows;
    },

    async findActiveStaff(salonId: string) {
        const { rows } = await pool.query(
            `SELECT id, first_name, last_name, designation, avatar_url
             FROM staff
             WHERE salon_id = $1 AND is_active = true
             ORDER BY first_name ASC`,
            [salonId]
        );
        return rows;
    },

    async findServiceById(id: string, salonId: string) {
        const { rows } = await pool.query(
            `SELECT id, name, description, price, price_type, duration_minutes AS duration
             FROM services
             WHERE id = $1 AND salon_id = $2 AND is_active = true`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async findStaffById(id: string, salonId: string) {
        const { rows } = await pool.query(
            `SELECT id, first_name, last_name, designation, avatar_url
             FROM staff
             WHERE id = $1 AND salon_id = $2 AND is_active = true`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async createAppointment(params: {
        salonId: string;
        branchId: string | null;
        clientId: string;
        staffId?: string | null;
        serviceId: string;
        title: string;
        scheduledAt: string;
        durationMinutes: number;
        notes?: string | null;
        services: unknown[];
    }) {
        const { rows } = await pool.query(
            `INSERT INTO appointments (
                salon_id, branch_id, client_id, staff_id, service_id,
                title, notes, status,
                scheduled_at, duration_minutes,
                ends_at,
                colour, created_by,
                services
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10,
                ($9::timestamptz + ($10::integer * INTERVAL '1 minute')),
                $11, $12,
                $13::jsonb
            )
            RETURNING *`,
            [
                params.salonId,
                params.branchId,
                params.clientId,
                params.staffId ?? null,
                params.serviceId,
                params.title,
                params.notes ?? null,
                "booked",
                params.scheduledAt,
                params.durationMinutes,
                "blue",
                null,
                JSON.stringify(params.services),
            ]
        );
        return rows[0];
    },
};
