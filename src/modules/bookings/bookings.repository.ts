import pool from "../../config/database";

// Postgres "undefined_column" — thrown if Migration/add_marketplace_booking_
// settings_and_saved_links.sql hasn't been run yet. Booking-policy reads are
// wrapped to fall back to defaults on this specific error so the core public
// booking flow (which must not depend on that migration) keeps working either way.
const UNDEFINED_COLUMN = "42703";
const DEFAULT_BOOKING_POLICY = {
    max_advance_days: 30,
    min_notice_hours: 0,
    cancellation_notice_hours: 0,
    slot_interval_minutes: 15,
};

// Public-facing salon lookups favor the salon's own business fields, then its
// marketplace listing, and only fall back to the owner's personal user-account
// phone/email as a last resort (small single-owner salons that never filled in
// separate business contact info) — never the owner's personal address, since
// there's no reasonable case where leaking that publicly is correct.
//
// Deliberately does NOT select the booking-policy columns (max_advance_days
// etc.) — those live behind a migration that may not have been run yet, and
// this query gates the entire public booking flow, so it must never fail
// because of that. See findBookingPolicy() below for those, fetched separately
// and defensively.
const PUBLIC_SALON_SELECT = `
    SELECT s.id, s.slug, s.description, s.city, s.state, s.country,
           s.logo_url, s.banner_url, s.currency,
           COALESCE(NULLIF(s.business_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '')) AS business_name,
           COALESCE(NULLIF(mp.business_phone, ''), NULLIF(s.phone, ''), u.phone) AS phone,
           COALESCE(NULLIF(s.email, ''), u.email) AS email,
           COALESCE(NULLIF(ml.address_line, ''), NULLIF(s.address, '')) AS address,
           mp.venue_description AS marketplace_description,
           mp.id AS marketplace_profile_id
    FROM salons s
    LEFT JOIN users u ON u.id = s.owner_id
    LEFT JOIN marketplace_profiles mp ON mp.salon_id = s.id
    LEFT JOIN marketplace_locations ml ON ml.profile_id = mp.id
`;

// No marketplace profile row at all (mp.is_published IS NULL) means this salon
// never touched the Marketplace Profile feature — treated as published so
// salons that only ever used Link Builder / direct booking links keep working.
const PUBLISHED_CONDITION = `(mp.is_published IS NULL OR mp.is_published = true)`;

export const bookingsRepository = {
    async findSalonBySlug(slug: string) {
        const { rows } = await pool.query(
            `${PUBLIC_SALON_SELECT}
             WHERE s.slug = $1 AND s.is_active = true AND ${PUBLISHED_CONDITION}`,
            [slug]
        );
        return rows[0] || null;
    },

    async findSalonById(salonId: string) {
        const { rows } = await pool.query(
            `${PUBLIC_SALON_SELECT}
             WHERE s.id = $1 AND s.is_active = true AND ${PUBLISHED_CONDITION}`,
            [salonId]
        );
        return rows[0] || null;
    },

    // Working hours + amenities live in the marketplace tables, keyed by
    // marketplace_profile_id (null when the salon has no marketplace profile).
    async findWorkingHours(marketplaceProfileId: string) {
        const { rows } = await pool.query(
            `SELECT day_of_week, is_open, open_time, close_time, slot_index
             FROM marketplace_working_hours
             WHERE profile_id = $1 ORDER BY day_of_week, slot_index`,
            [marketplaceProfileId]
        );
        return rows;
    },

    async findAmenities(marketplaceProfileId: string) {
        const { rows } = await pool.query(
            `SELECT feature_key FROM marketplace_features
             WHERE profile_id = $1 AND feature_type = 'amenity'`,
            [marketplaceProfileId]
        );
        return rows.map((r) => r.feature_key as string);
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

    // Real availability needs every non-cancelled appointment for the salon
    // on the given date, per staff — used to exclude already-booked ranges
    // from the slots offered on the public booking page.
    async findAppointmentsForDate(salonId: string, dateStr: string) {
        const { rows } = await pool.query(
            `SELECT staff_id, scheduled_at, duration_minutes
             FROM appointments
             WHERE salon_id = $1
               AND scheduled_at >= $2::date AND scheduled_at < ($2::date + INTERVAL '1 day')
               AND status NOT IN ('cancelled', 'deleted')`,
            [salonId, dateStr]
        );
        return rows;
    },

    // Per-staff working hours for a specific date — the real source of truth
    // for online booking availability (Staff Schedule / Working Hours, Web →
    // Team → Staff Schedule). A row with `date` set is a one-off override for
    // that exact day; a row with `date IS NULL` is the recurring weekly
    // default for that day_of_week. Only the single best-matching row per
    // staff member is needed, so this picks it in SQL (date match wins).
    async findStaffScheduleForDate(staffIds: string[], dateStr: string, dayOfWeek: number) {
        if (staffIds.length === 0) return [];
        const { rows } = await pool.query(
            `SELECT DISTINCT ON (staff_id) staff_id, is_available, start_time, end_time
             FROM staff_schedules
             WHERE staff_id = ANY($1::uuid[])
               AND (date = $2::date OR (date IS NULL AND day_of_week = $3))
             ORDER BY staff_id, date NULLS LAST`,
            [staffIds, dateStr, dayOfWeek]
        );
        return rows;
    },

    // Which of these staff have ever had a schedule configured at all — used
    // to fall back to the salon-wide marketplace hours ONLY for staff who've
    // never touched Staff Schedule, never as a per-day gap-filler (a
    // configured staff member with no row for this specific day means they
    // don't work that day, not "ask the salon instead").
    async findStaffIdsWithAnySchedule(staffIds: string[]): Promise<Set<string>> {
        if (staffIds.length === 0) return new Set();
        const { rows } = await pool.query(
            `SELECT DISTINCT staff_id FROM staff_schedules WHERE staff_id = ANY($1::uuid[])`,
            [staffIds]
        );
        return new Set(rows.map((r) => r.staff_id as string));
    },

    async findMarketplaceDayHours(salonId: string, dayOfWeek: number) {
        try {
            const { rows } = await pool.query(
                `SELECT wh.is_open, wh.open_time, wh.close_time, mp.slot_interval_minutes
                 FROM marketplace_profiles mp
                 JOIN marketplace_working_hours wh ON wh.profile_id = mp.id AND wh.day_of_week = $2
                 WHERE mp.salon_id = $1
                 ORDER BY wh.slot_index ASC LIMIT 1`,
                [salonId, dayOfWeek]
            );
            return rows[0] || null;
        } catch (err: any) {
            if (err?.code !== UNDEFINED_COLUMN) throw err;
            const { rows } = await pool.query(
                `SELECT wh.is_open, wh.open_time, wh.close_time
                 FROM marketplace_profiles mp
                 JOIN marketplace_working_hours wh ON wh.profile_id = mp.id AND wh.day_of_week = $2
                 WHERE mp.salon_id = $1
                 ORDER BY wh.slot_index ASC LIMIT 1`,
                [salonId, dayOfWeek]
            );
            return rows[0] ? { ...rows[0], slot_interval_minutes: DEFAULT_BOOKING_POLICY.slot_interval_minutes } : null;
        }
    },

    // Fetched separately from PUBLIC_SALON_SELECT (see comment there) and
    // defended against the migration not having run yet.
    async findBookingPolicy(salonId: string) {
        try {
            const { rows } = await pool.query(
                `SELECT max_advance_days, min_notice_hours, cancellation_notice_hours, slot_interval_minutes
                 FROM marketplace_profiles WHERE salon_id = $1`,
                [salonId]
            );
            return rows[0] ?? DEFAULT_BOOKING_POLICY;
        } catch (err: any) {
            if (err?.code !== UNDEFINED_COLUMN) throw err;
            return DEFAULT_BOOKING_POLICY;
        }
    },

    async createAppointment(params: {
        salonId: string;
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
                salon_id, client_id, staff_id, service_id,
                title, notes, status,
                scheduled_at, duration_minutes,
                ends_at,
                colour, created_by,
                services
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9,
                ($8::timestamptz + ($9::integer * INTERVAL '1 minute')),
                $10, $11,
                $12::jsonb
            )
            RETURNING *`,
            [
                params.salonId,
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
