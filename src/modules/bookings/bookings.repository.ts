import pool from "../../config/database";

// Postgres "undefined_column" — thrown if Migration/add_marketplace_booking_
// settings_and_saved_links.sql hasn't been run yet. Booking-policy reads are
// wrapped to fall back to defaults on this specific error so the core public
// booking flow (which must not depend on that migration) keeps working either way.
const UNDEFINED_COLUMN = "42703";

// The one timezone every wall-clock comparison in online booking is done in.
// `appointments.scheduled_at` is a timestamptz (an instant), while staff
// schedules, marketplace working hours and blocked times are all TIME columns
// holding local wall clock — so an instant has to be converted to this zone
// before the two can be compared at all. Reading UTC hours off scheduled_at
// instead (what this used to do) shifted every booked range by the UTC offset,
// which is why a 1:00 PM appointment never removed the 1:00 PM slot.
//
// Hardcoded because there is no per-salon timezone column yet; the rest of this
// module already assumes Asia/Kolkata (see formatDate/formatTime in
// bookings.service.ts). When a salon timezone lands, this is the single place
// to thread it through from.
export const SALON_TIMEZONE = "Asia/Kolkata";

const DEFAULT_BOOKING_POLICY = {
    max_advance_days: 30,
    min_notice_hours: 0,
    cancellation_notice_hours: 0,
    slot_interval_minutes: 15,
    // Same-day booking is allowed unless a salon turns it off — the permissive
    // default keeps every salon behaving as it did before the setting existed,
    // including salons whose database hasn't had the column added yet.
    allow_same_day_booking: true,
    // About Us section: shown, with no links configured. `website` lives here
    // rather than in PUBLIC_SALON_SELECT for the same reason as the rest — that
    // query gates the entire public booking flow and must not reference a
    // column a given environment might not have yet.
    about_enabled: true,
    instagram_url: null as string | null,
    facebook_url: null as string | null,
    website: null as string | null,
    // Multi-service booking has always been possible, so it stays on by default.
    allow_multiple_services: true,
};

// Which of the optional marketplace_profiles settings columns this database
// actually has. Every key of DEFAULT_BOOKING_POLICY is a column added by some
// migration, and environments drift (see the dev/QA/prod migration gap), so the
// set is resolved once from information_schema and cached — one query per
// process rather than one per booking page load.
let optionalProfileColumnsCache: Set<string> | null = null;

async function optionalProfileColumns(): Promise<Set<string>> {
    if (optionalProfileColumnsCache) return optionalProfileColumnsCache;
    const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'marketplace_profiles'`
    );
    optionalProfileColumnsCache = new Set(rows.map((r) => r.column_name as string));
    return optionalProfileColumnsCache;
}

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

// Online Booking is OPT-IN (DECISION-OB-001): a salon is publicly bookable only
// once it has explicitly published. A salon that never touched the Marketplace
// Profile feature is NOT bookable — which is the opposite of the old rule, where
// a missing profile row counted as published and left most salons publicly
// listed without ever having asked.
//
// Salons already live when this shipped are grandfathered by
// Migration/backfill_online_booking_opt_in.sql, which publishes any salon that
// already has online bookings or saved booking links, so no working link goes
// dark. Run that migration BEFORE deploying this, or currently-live salons 404.
const PUBLISHED_CONDITION = `(mp.is_published = true)`;

export const bookingsRepository = {
    async findSalonBySlug(slug: string) {
        const { rows } = await pool.query(
            `${PUBLIC_SALON_SELECT}
             WHERE s.slug = $1 AND s.is_active = true AND ${PUBLISHED_CONDITION}`,
            [slug]
        );
        return rows[0] || null;
    },

    // Deliberately ignores the is_active / is_published gates, so the caller can
    // tell "this link is wrong" apart from "this salon exists but has online
    // booking switched off" and say the right thing to the customer.
    async findSalonStateBySlug(slug: string) {
        const { rows } = await pool.query(
            `SELECT s.is_active, mp.is_published
             FROM salons s
             LEFT JOIN marketplace_profiles mp ON mp.salon_id = s.id
             WHERE s.slug = $1`,
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

    // Staff a customer is actually allowed to book online.
    //
    // Three gates:
    //   • is_active               — obviously.
    //   • allow_calendar_bookings — the salon's own "this person takes
    //     bookings" switch, which online booking previously ignored entirely.
    //   • service_staff mapping   — who performs the selected services.
    //
    // The mapping gate is deliberately conditional: a service with NO rows in
    // service_staff imposes no restriction, because in practice almost nothing
    // is mapped (1 row across the whole dev database). Treating "unmapped" as
    // "nobody can do it" would empty every salon's stylist list and take online
    // booking down. So a staff member is excluded only for services that have
    // been explicitly mapped to someone else.
    //
    // Ratings come from real `reviews` rows attributed to the staff member; a
    // stylist with no reviews returns null rather than a flattering default.
    async findActiveStaff(salonId: string, serviceIds?: string[] | null) {
        const ids = Array.isArray(serviceIds) && serviceIds.length > 0 ? serviceIds : null;
        const { rows } = await pool.query(
            `SELECT s.id, s.first_name, s.last_name, s.designation, s.avatar_url,
                    ROUND(r.avg_rating::numeric, 1)::float8 AS rating,
                    COALESCE(r.review_count, 0)::int        AS review_count
             FROM staff s
             LEFT JOIN (
                 SELECT staff_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
                 FROM reviews
                 WHERE salon_id = $1 AND staff_id IS NOT NULL AND rating IS NOT NULL
                 GROUP BY staff_id
             ) r ON r.staff_id = s.id
             WHERE s.salon_id = $1
               AND s.is_active = true
               AND COALESCE(s.allow_calendar_bookings, true) = true
               AND (
                 $2::uuid[] IS NULL
                 OR NOT EXISTS (
                   SELECT 1
                   FROM unnest($2::uuid[]) AS req(service_id)
                   WHERE EXISTS (SELECT 1 FROM service_staff m WHERE m.service_id = req.service_id)
                     AND NOT EXISTS (
                       SELECT 1 FROM service_staff m2
                       WHERE m2.service_id = req.service_id AND m2.staff_id = s.id
                     )
                 )
               )
             ORDER BY s.first_name ASC`,
            [salonId, ids]
        );
        return rows;
    },

    // Is this specific staff member bookable online for these services? Mirrors
    // findActiveStaff's gates so the list a customer sees and the submission
    // that's accepted can't disagree.
    async isStaffEligible(staffId: string, salonId: string, serviceIds?: string[] | null): Promise<boolean> {
        const ids = Array.isArray(serviceIds) && serviceIds.length > 0 ? serviceIds : null;
        const { rows } = await pool.query(
            `SELECT 1
             FROM staff s
             WHERE s.id = $1 AND s.salon_id = $2
               AND s.is_active = true
               AND COALESCE(s.allow_calendar_bookings, true) = true
               AND (
                 $3::uuid[] IS NULL
                 OR NOT EXISTS (
                   SELECT 1
                   FROM unnest($3::uuid[]) AS req(service_id)
                   WHERE EXISTS (SELECT 1 FROM service_staff m WHERE m.service_id = req.service_id)
                     AND NOT EXISTS (
                       SELECT 1 FROM service_staff m2
                       WHERE m2.service_id = req.service_id AND m2.staff_id = s.id
                     )
                 )
               )
             LIMIT 1`,
            [staffId, salonId, ids]
        );
        return rows.length > 0;
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
    //
    // Both the day window and the returned start time are in salon-local wall
    // clock, converted here in SQL so Postgres' own tz database does the work:
    // `$2::date` is the salon's local day (not a UTC day, which would put an
    // evening appointment on the wrong date), and `start_minute` is minutes
    // from local midnight, directly comparable to the schedule/blocked-time
    // windows the slot grid is built from. Cast to int because the pg driver
    // hands NUMERIC back as a string.
    async findAppointmentsForDate(salonId: string, dateStr: string) {
        const { rows } = await pool.query(
            `SELECT staff_id,
                    (EXTRACT(HOUR   FROM (scheduled_at AT TIME ZONE $3)) * 60 +
                     EXTRACT(MINUTE FROM (scheduled_at AT TIME ZONE $3)))::int AS start_minute,
                    duration_minutes
             FROM appointments
             WHERE salon_id = $1
               AND (scheduled_at AT TIME ZONE $3) >= $2::date
               AND (scheduled_at AT TIME ZONE $3) <  ($2::date + INTERVAL '1 day')
               AND status NOT IN ('cancelled', 'deleted')`,
            [salonId, dateStr, SALON_TIMEZONE]
        );
        return rows;
    },

    // Does this staff member already have a non-cancelled appointment
    // overlapping [startMinute, endMinute) on this local date? The slot list
    // excludes booked ranges, but that list is built once and can be stale by
    // the time it's submitted (or bypassed entirely by a direct API call), so
    // the same question has to be asked again at write time. `excludeId` lets
    // a reschedule ignore the appointment being moved.
    // Serialises concurrent public bookings for one salon on one date.
    //
    // BUG-OB-002 asks for real concurrency protection, and a read-then-write
    // overlap check can't provide it: two requests can both read "free" before
    // either inserts. A transaction-scoped advisory lock keyed on
    // (salon, local date) makes those requests queue instead — narrow enough
    // that unrelated salons and other dates never contend, and released
    // automatically when the transaction ends, including on error.
    //
    // An exclusion constraint over a tsrange would be stronger still, but it
    // needs btree_gist plus a generated range column and would also police the
    // internal staff-facing calendar, where staff deliberately double-book at
    // times. Deliberately scoped to the public flow.
    async withBookingLock<T>(
        salonId: string,
        dateStr: string,
        work: (client: import("pg").PoolClient) => Promise<T>
    ): Promise<T> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            // Two 32-bit keys rather than one hashed string: salon and date stay
            // independently distinguishable, so collisions can't silently
            // serialise unrelated salons.
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1)::int, hashtext($2)::int)`,
                [salonId, dateStr]
            );
            const result = await work(client);
            await client.query("COMMIT");
            return result;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async hasAppointmentOverlap(params: {
        salonId: string;
        staffId: string;
        dateStr: string;
        startMinute: number;
        endMinute: number;
        excludeId?: string | null;
    }, client?: import("pg").PoolClient): Promise<boolean> {
        const db = client ?? pool;
        const { rows } = await db.query(
            `SELECT 1
             FROM appointments
             WHERE salon_id = $1
               AND staff_id = $2
               AND status NOT IN ('cancelled', 'deleted')
               AND ($6::uuid IS NULL OR id <> $6::uuid)
               AND (scheduled_at AT TIME ZONE $7) >= $3::date
               AND (scheduled_at AT TIME ZONE $7) <  ($3::date + INTERVAL '1 day')
               AND (EXTRACT(HOUR   FROM (scheduled_at AT TIME ZONE $7)) * 60 +
                    EXTRACT(MINUTE FROM (scheduled_at AT TIME ZONE $7))) < $5
               AND (EXTRACT(HOUR   FROM (scheduled_at AT TIME ZONE $7)) * 60 +
                    EXTRACT(MINUTE FROM (scheduled_at AT TIME ZONE $7))
                    + COALESCE(duration_minutes, 30)) > $4
             LIMIT 1`,
            [params.salonId, params.staffId, params.dateStr, params.startMinute, params.endMinute, params.excludeId ?? null, SALON_TIMEZONE]
        );
        return rows.length > 0;
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
            `SELECT DISTINCT ON (staff_id) staff_id, is_available, start_time, end_time, breaks
             FROM staff_schedules
             WHERE staff_id = ANY($1::uuid[])
               AND (date = $2::date OR (date IS NULL AND day_of_week = $3))
             ORDER BY staff_id, date NULLS LAST`,
            [staffIds, dateStr, dayOfWeek]
        );
        return rows;
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
    // Several migrations have each added settings columns to
    // marketplace_profiles, and any of them can be un-run on a given
    // environment. Rather than a tower of try/catch fallbacks that has to grow
    // with every migration — and that loses a salon's real settings whenever
    // only the newest column is missing — ask the database once which of these
    // columns actually exist and select only those, merging defaults for the
    // rest. Cached for the process lifetime, so the API needs a restart after
    // running a migration before the new settings take effect.
    async findBookingPolicy(salonId: string) {
        const present = await optionalProfileColumns();
        const wanted = Object.keys(DEFAULT_BOOKING_POLICY).filter((c) => present.has(c));
        if (wanted.length === 0) return { ...DEFAULT_BOOKING_POLICY };

        const { rows } = await pool.query(
            `SELECT ${wanted.join(", ")} FROM marketplace_profiles WHERE salon_id = $1`,
            [salonId]
        );
        return rows[0] ? { ...DEFAULT_BOOKING_POLICY, ...rows[0] } : { ...DEFAULT_BOOKING_POLICY };
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
