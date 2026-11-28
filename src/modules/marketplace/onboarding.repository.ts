import pool from "../../config/database";
import type { ServiceSetting, StoredStatus } from "./onboarding.rules";

// SQL for the Marketplace onboarding. Salon, service, staff, hours, location and photo data stay in their
// existing tables; see Migration/add_marketplace_onboarding.sql for the little that is new.

/** Postgres "undefined_table" / "undefined_column": the migration has not been run. */
export const isMissingMigration = (err: any) => err?.code === "42P01" || err?.code === "42703";

export interface OnboardingRow {
    salon_id: string;
    status: StoredStatus;
    current_step: number;
    location_place_id: string | null;
    location_confirmed_at: string | null;
    confirmed_latitude: string | null;
    confirmed_longitude: string | null;
    hidden_staff_ids: string[];
    bookings_enabled: boolean;
    services_saved_at: string | null;
    availability_saved_at: string | null;
    preferences_saved_at: string | null;
    terms_accepted_at: string | null;
    submitted_at: string | null;
    reviewed_at: string | null;
    rejection_reason: string | null;
    updated_at: string;
}

// Only these columns can be set through update(), so a column name never comes from a request.
const UPDATABLE = new Set([
    "status", "current_step", "location_place_id", "location_confirmed_at", "confirmed_latitude", "confirmed_longitude",
    "hidden_staff_ids", "bookings_enabled", "services_saved_at", "availability_saved_at", "preferences_saved_at",
    "terms_accepted_at", "terms_accepted_by", "submitted_at", "reviewed_at", "reviewed_by", "rejection_reason",
]);

export const onboardingRepository = {
    async find(salonId: string): Promise<OnboardingRow | null> {
        const { rows } = await pool.query(`SELECT * FROM marketplace_onboarding WHERE salon_id = $1`, [salonId]);
        return rows[0] ?? null;
    },

    async ensure(salonId: string): Promise<void> {
        await pool.query(`INSERT INTO marketplace_onboarding (salon_id) VALUES ($1) ON CONFLICT (salon_id) DO NOTHING`, [salonId]);
    },

    async update(salonId: string, patch: Record<string, unknown>): Promise<void> {
        const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
        if (!keys.length) return;
        await pool.query(
            `UPDATE marketplace_onboarding SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE salon_id = $1`,
            [salonId, ...keys.map((k) => patch[k])]
        );
    },

    /** Moves the status only from one of `from`, so two reviewers (or a double click) can't both act. */
    async transition(salonId: string, from: StoredStatus[], patch: Record<string, unknown>): Promise<boolean> {
        const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
        const { rowCount } = await pool.query(
            `UPDATE marketplace_onboarding SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(", ")}, updated_at = now()
             WHERE salon_id = $1 AND status = ANY($2::text[])`,
            [salonId, from, ...keys.map((k) => patch[k])]
        );
        return (rowCount ?? 0) > 0;
    },

    async findSalon(salonId: string) {
        const { rows } = await pool.query(
            `SELECT s.id, s.slug, s.business_name, s.description, s.email, s.phone, s.address, s.city, s.state, s.country, s.pincode,
                    s.business_category, s.business_type, s.website_url, s.currency, s.is_active, COALESCE(s.is_dummy, false) AS is_dummy
             FROM salons s WHERE s.id = $1`,
            [salonId]
        );
        return rows[0] ?? null;
    },

    async saveBusiness(salonId: string, b: { name: string; description: string; category: string | null; business_type: string; phone: string; email: string; website: string | null; instagram: string | null }) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            // The salon's own record is the one source for its name, description, category and type.
            await client.query(
                `UPDATE salons SET business_name = $2, description = $3, business_category = $4, business_type = $5, updated_at = NOW() WHERE id = $1`,
                [salonId, b.name, b.description, b.category, b.business_type]
            );
            // Public contact details live on the Marketplace profile, so the salon's billing phone and email stay untouched.
            await client.query(
                `INSERT INTO marketplace_profiles (salon_id, display_name, business_phone, business_email, website, instagram_url, venue_description)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (salon_id) DO UPDATE SET
                    display_name = EXCLUDED.display_name, business_phone = EXCLUDED.business_phone, business_email = EXCLUDED.business_email,
                    website = EXCLUDED.website, instagram_url = EXCLUDED.instagram_url, venue_description = EXCLUDED.venue_description, updated_at = NOW()`,
                [salonId, b.name, b.phone, b.email, b.website, b.instagram, b.description]
            );
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async listPhotos(profileId: string) {
        const { rows } = await pool.query(
            `SELECT id, image_url, is_cover, sort_order, category FROM marketplace_images WHERE profile_id = $1 ORDER BY sort_order, created_at`,
            [profileId]
        );
        return rows as { id: string; image_url: string; is_cover: boolean; sort_order: number; category: string | null }[];
    },

    async setPhotoCategory(profileId: string, imageId: string, category: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `UPDATE marketplace_images SET category = $3, updated_at = NOW() WHERE id = $2 AND profile_id = $1`,
            [profileId, imageId, category]
        );
        return (rowCount ?? 0) > 0;
    },

    async serviceSettings(salonId: string): Promise<Map<string, ServiceSetting>> {
        const { rows } = await pool.query(
            `SELECT service_id, is_listed, display_price FROM marketplace_service_settings WHERE salon_id = $1`,
            [salonId]
        );
        return new Map(rows.map((r) => [String(r.service_id), { is_listed: r.is_listed, display_price: r.display_price }]));
    },

    /** The INSERT joins `services` on the salon, so another salon's service id is silently ignored. */
    async saveServiceSettings(salonId: string, items: { service_id: string; is_listed: boolean; display_price: number | null }[]) {
        await pool.query(
            `INSERT INTO marketplace_service_settings (salon_id, service_id, is_listed, display_price, updated_at)
             SELECT $1, v.id, x.is_listed, x.display_price, now()
             FROM jsonb_to_recordset($2::jsonb) AS x(service_id uuid, is_listed boolean, display_price numeric)
             JOIN services v ON v.id = x.service_id AND v.salon_id = $1
             ON CONFLICT (salon_id, service_id) DO UPDATE SET
                is_listed = EXCLUDED.is_listed, display_price = EXCLUDED.display_price, updated_at = now()`,
            [salonId, JSON.stringify(items)]
        );
    },

    async countServicesNotOpenOnline(salonId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS total FROM services WHERE salon_id = $1 AND is_active = true AND online_booking = false`,
            [salonId]
        );
        return rows[0].total;
    },

    /** staff id -> the salon's service ids assigned to them (the CRM's own service_staff table). */
    async staffServiceIds(salonId: string): Promise<Map<string, string[]>> {
        const { rows } = await pool.query(
            `SELECT ss.staff_id, ss.service_id FROM service_staff ss
             JOIN services v ON v.id = ss.service_id AND v.salon_id = $1`,
            [salonId]
        );
        const map = new Map<string, string[]>();
        for (const r of rows) map.set(r.staff_id, [...(map.get(r.staff_id) ?? []), r.service_id]);
        return map;
    },

    async replaceStaffServices(salonId: string, staffId: string, serviceIds: string[]) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                `DELETE FROM service_staff WHERE staff_id = $2 AND service_id IN (SELECT id FROM services WHERE salon_id = $1)`,
                [salonId, staffId]
            );
            await client.query(
                `INSERT INTO service_staff (service_id, staff_id)
                 SELECT v.id, $2 FROM services v WHERE v.salon_id = $1 AND v.id = ANY($3::uuid[])`,
                [salonId, staffId, serviceIds]
            );
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /** Each staff member's regular weekly rows from Staff Schedule (date IS NULL). Read only. */
    async weeklySchedules(staffIds: string[]) {
        if (!staffIds.length) return [];
        const { rows } = await pool.query(
            `SELECT staff_id, day_of_week, is_available, start_time, end_time FROM staff_schedules
             WHERE staff_id = ANY($1::uuid[]) AND date IS NULL ORDER BY staff_id, day_of_week`,
            [staffIds]
        );
        return rows;
    },

    /** Marketplace bookings are ordinary rows in the CRM's appointments table. No client details here. */
    async bookingActivity(salonId: string) {
        const [totals, recent] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE scheduled_at >= now() AND status NOT IN ('cancelled', 'deleted'))::int AS upcoming
                 FROM appointments WHERE salon_id = $1 AND via_marketplace`,
                [salonId]
            ),
            pool.query(
                `SELECT id, booking_number, title, scheduled_at, status FROM appointments
                 WHERE salon_id = $1 AND via_marketplace ORDER BY created_at DESC LIMIT 5`,
                [salonId]
            ),
        ]);
        return { ...totals.rows[0], recent: recent.rows };
    },

    async markViaMarketplace(appointmentId: string, client: import("pg").PoolClient) {
        await client.query(`UPDATE appointments SET via_marketplace = true WHERE id = $1`, [appointmentId]);
    },

    async listForReview(status: StoredStatus) {
        const { rows } = await pool.query(
            `SELECT o.salon_id, o.status, o.submitted_at, o.reviewed_at, o.rejection_reason,
                    s.slug, s.business_name, s.city, COALESCE(s.is_dummy, false) AS is_dummy
             FROM marketplace_onboarding o JOIN salons s ON s.id = o.salon_id
             WHERE o.status = $1 ORDER BY o.submitted_at ASC NULLS LAST LIMIT 200`,
            [status]
        );
        return rows;
    },
};
