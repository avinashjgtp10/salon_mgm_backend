import pool from "../../config/database";
import { getSalonTimezone, DEFAULT_SALON_TIMEZONE } from "../../config/salonTimezone";
import { digitalMenuRepository } from "../digital-menu/digital-menu.repository";

// Postgres "undefined_column" — thrown if Migration/add_marketplace_booking_
// settings_and_saved_links.sql hasn't been run yet. Booking-policy reads are
// wrapped to fall back to defaults on this specific error so the core public
// booking flow (which must not depend on that migration) keeps working either way.
const UNDEFINED_COLUMN = "42703";
// Postgres undefined_table — an environment that is behind on migrations.
const UNDEFINED_TABLE = "42P01";

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
export const SALON_TIMEZONE = DEFAULT_SALON_TIMEZONE;

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
           s.logo_url, s.banner_url, s.currency, s.timezone,
           COALESCE(to_jsonb(s) ->> 'language', 'en') AS language,
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
    // Marketplace list: salons SalonOx has approved, that have published Online
    // Booking and have at least one service listed. One query, not one per salon.
    // Deliberately returns no phone or email: PUBLIC_SALON_SELECT can fall back
    // to the owner's personal contact details, which must not be listed in bulk.
    // The service filter matches findActiveServices (including the Digital Menu
    // selection), so a card never advertises a service the salon page hides.
    async findDirectory(limit = 200) {
        try {
        const { rows } = await pool.query(
            `SELECT s.id, s.slug, COALESCE(NULLIF(ml.city, ''), s.city) AS city, COALESCE(NULLIF(ml.state, ''), s.state) AS state,
                    s.currency, s.timezone, s.logo_url, mo.bookings_enabled,
                    -- The week's hours, for the "Open now" filter.
                    (SELECT json_agg(json_build_object('day_of_week', h.day_of_week, 'is_open', h.is_open, 'open_time', h.open_time, 'close_time', h.close_time))
                     FROM marketplace_working_hours h WHERE h.profile_id = mp.id) AS hours,
                    -- The pin the salon confirmed for customers to find it.
                    ml.latitude::float8 AS latitude, ml.longitude::float8 AS longitude,
                    -- Weekdays (0 = Sunday) the salon is open, for the Marketplace date search.
                    ARRAY(SELECT DISTINCT wh.day_of_week::int FROM marketplace_working_hours wh
                          WHERE wh.profile_id = mp.id AND wh.is_open ORDER BY 1) AS open_days,
                    COALESCE(NULLIF(s.business_name, ''), NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '')) AS business_name,
                    COALESCE(NULLIF(ml.address_line, ''), NULLIF(s.address, '')) AS address,
                    COALESCE(img.image_url, NULLIF(mp.cover_url, ''), NULLIF(s.banner_url, '')) AS cover_url,
                    rv.rating, COALESCE(rv.review_count, 0)::int AS review_count,
                    sv.service_count, sv.min_price, sv.categories, sv.service_names, top.top_services
             FROM salons s
             JOIN marketplace_profiles mp ON mp.salon_id = s.id
             JOIN marketplace_onboarding mo ON mo.salon_id = s.id AND mo.status = 'approved'
             LEFT JOIN users u ON u.id = s.owner_id
             LEFT JOIN marketplace_locations ml ON ml.profile_id = mp.id
             LEFT JOIN digital_menus dm ON dm.salon_id = s.id
             JOIN LATERAL (
                 SELECT COUNT(*)::int AS service_count,
                        (MIN(COALESCE(mss.display_price, v.price)) FILTER (WHERE COALESCE(mss.display_price, v.price) > 0))::float8 AS min_price,
                        ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(c.name), ''), 'Other')) AS categories,
                        (ARRAY_AGG(DISTINCT v.name))[1:300] AS service_names
                 FROM services v
                 LEFT JOIN service_categories c ON c.id = v.category_id
                 LEFT JOIN marketplace_service_settings mss ON mss.salon_id = v.salon_id AND mss.service_id = v.id
                 WHERE v.salon_id = s.id AND v.is_active = true AND v.online_booking = true
                   AND COALESCE(mss.is_listed, true)
                   AND (dm.service_selection_mode IS DISTINCT FROM 'specific'
                        OR EXISTS (SELECT 1 FROM digital_menu_services dms WHERE dms.menu_id = dm.id AND dms.service_id = v.id))
             ) sv ON sv.service_count > 0
             LEFT JOIN LATERAL (
                 SELECT ROUND(AVG(r.rating)::numeric, 1)::float8 AS rating, COUNT(*) AS review_count
                 FROM reviews r
                 WHERE r.salon_id = s.id AND r.is_visible = true AND r.rating IS NOT NULL
             ) rv ON true
             LEFT JOIN LATERAL (
                 SELECT i.image_url FROM marketplace_images i
                 WHERE i.profile_id = mp.id AND NULLIF(TRIM(COALESCE(i.image_url, '')), '') IS NOT NULL
                 ORDER BY i.is_cover DESC, i.sort_order ASC NULLS LAST, i.created_at ASC
                 LIMIT 1
             ) img ON true
             -- Up to 3 services for the salon's card: the most booked first, then the salon's own menu order.
             LEFT JOIN LATERAL (
                 SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'duration', t.duration, 'price', t.price, 'price_type', t.price_type) ORDER BY t.position) AS top_services
                 FROM (
                     SELECT v.id, v.name, v.duration_minutes AS duration, COALESCE(mss.display_price, v.price)::float8 AS price, v.price_type,
                            ROW_NUMBER() OVER (ORDER BY COALESCE(b.bookings, 0) DESC, c.display_order NULLS LAST, c.name NULLS LAST, v.name) AS position
                     FROM services v
                     LEFT JOIN service_categories c ON c.id = v.category_id
                     LEFT JOIN marketplace_service_settings mss ON mss.salon_id = v.salon_id AND mss.service_id = v.id
                     LEFT JOIN (
                         SELECT service_id, COUNT(*) AS bookings FROM appointments
                         WHERE salon_id = s.id AND status NOT IN ('cancelled', 'deleted') GROUP BY service_id
                     ) b ON b.service_id = v.id
                     WHERE v.salon_id = s.id AND v.is_active = true AND v.online_booking = true
                       AND COALESCE(mss.is_listed, true)
                       AND (dm.service_selection_mode IS DISTINCT FROM 'specific'
                            OR EXISTS (SELECT 1 FROM digital_menu_services dms WHERE dms.menu_id = dm.id AND dms.service_id = v.id))
                     ORDER BY position
                     LIMIT 3
                 ) t
             ) top ON true
             WHERE s.is_active = true AND ${PUBLISHED_CONDITION}
               -- Demo salons (marked by Super Admin) are never shown to the public list.
               AND COALESCE(s.is_dummy, false) = false
             ORDER BY rv.review_count DESC NULLS LAST, business_name ASC
             LIMIT $1`,
            [limit]
        );
        return rows;
        } catch (err: any) {
            // Migration/add_marketplace_onboarding.sql not run yet: no salon can be approved, so none is listed.
            if (err?.code === UNDEFINED_TABLE || err?.code === UNDEFINED_COLUMN) return [];
            throw err;
        }
    },

    // The features each listed salon saved on its Marketplace Profile, for the Salons page filter.
    // A separate query, so a problem here never empties the salon list.
    async findDirectoryFeatures(salonIds: string[]) {
        if (!salonIds.length) return [];
        try {
            const { rows } = await pool.query(
                `SELECT mp.salon_id, f.feature_key
                 FROM marketplace_features f
                 JOIN marketplace_profiles mp ON mp.id = f.profile_id
                 WHERE mp.salon_id::text = ANY($1::text[])`,
                [salonIds]
            );
            return rows as { salon_id: string; feature_key: string }[];
        } catch (err: any) {
            if (err?.code === "42P01" || err?.code === "42703") return [];
            throw err;
        }
    },

    // The newest written reviews across approved salons, for the Marketplace homepage. Every rating is
    // included (never only the good ones), and only the reviewer's first name leaves the server.
    async findDirectoryReviews(limit = 30) {
        try {
            const { rows } = await pool.query(
                `SELECT r.id, r.rating, r.review_text, r.created_at, s.id AS salon_id, s.slug,
                        s.business_name AS salon_name, COALESCE(NULLIF(c.first_name, ''), 'Guest') AS client_first_name
                 FROM reviews r
                 JOIN salons s ON s.id = r.salon_id
                 JOIN marketplace_profiles mp ON mp.salon_id = s.id
                 JOIN marketplace_onboarding mo ON mo.salon_id = s.id AND mo.status = 'approved'
                 LEFT JOIN clients c ON c.id = r.client_id
                 WHERE r.is_visible = true AND r.rating IS NOT NULL AND NULLIF(TRIM(r.review_text), '') IS NOT NULL
                   AND s.is_active = true AND ${PUBLISHED_CONDITION} AND COALESCE(s.is_dummy, false) = false
                 ORDER BY r.created_at DESC
                 LIMIT $1`,
                [limit]
            );
            return rows;
        } catch (err: any) {
            if (err?.code === UNDEFINED_TABLE || err?.code === UNDEFINED_COLUMN) return [];
            throw err;
        }
    },

    // The owner's preview before approval: the public columns without the published/approved gates.
    async findSalonForPreview(salonId: string) {
        const { rows } = await pool.query(`${PUBLIC_SALON_SELECT} WHERE s.id = $1`, [salonId]);
        return rows[0] || null;
    },

    // The map pin saved with the salon's Marketplace address, or null.
    async findMapPin(marketplaceProfileId: string) {
        const { rows } = await pool.query(
            `SELECT latitude::float8 AS latitude, longitude::float8 AS longitude
             FROM marketplace_locations
             WHERE profile_id = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
             LIMIT 1`,
            [marketplaceProfileId]
        );
        return rows[0] || null;
    },

    // The week's opening hours, as saved in the salon's Marketplace Profile.
    async findWeekHours(marketplaceProfileId: string) {
        const { rows } = await pool.query(
            `SELECT day_of_week, is_open, open_time, close_time
             FROM marketplace_working_hours
             WHERE profile_id = $1
             ORDER BY day_of_week, slot_index`,
            [marketplaceProfileId]
        );
        return rows;
    },

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

    // Facilities/Amenities + Salon Specialities (Highlights/Values) for the
    // public About Us section — same marketplace_features rows the admin
    // Marketplace Profile page's Facilities & Amenities / Salon Specialities
    // checkboxes save. Tolerant of a missing table, same reasoning as gallery.
    async findFeatures(marketplaceProfileId: string): Promise<{ amenities: string[]; highlights: string[]; values: string[] }> {
        try {
            const { rows } = await pool.query(
                `SELECT feature_type, feature_key FROM marketplace_features WHERE profile_id = $1`,
                [marketplaceProfileId]
            );
            return {
                amenities:  rows.filter((r) => r.feature_type === "amenity").map((r) => r.feature_key),
                highlights: rows.filter((r) => r.feature_type === "highlight").map((r) => r.feature_key),
                values:     rows.filter((r) => r.feature_type === "value").map((r) => r.feature_key),
            };
        } catch (err: any) {
            if (err?.code === "42P01" || err?.code === "42703") return { amenities: [], highlights: [], values: [] };
            throw err;
        }
    },

    // Gallery photos for the public hero band's background. Cover first, then
    // the salon's own ordering — the same order the Marketplace Profile
    // editor shows. Tolerant of a missing table so an un-migrated environment
    // renders the page without a hero photo rather than 500ing the booking flow.
    async findGalleryImages(marketplaceProfileId: string) {
        try {
            const { rows } = await pool.query(
                `SELECT image_url
                 FROM marketplace_images
                 WHERE profile_id = $1
                   AND NULLIF(TRIM(COALESCE(image_url, '')), '') IS NOT NULL
                 ORDER BY is_cover DESC, sort_order ASC NULLS LAST, created_at ASC
                 LIMIT 20`,
                [marketplaceProfileId]
            );
            return rows.map((r) => r.image_url as string);
        } catch (err: any) {
            if (err?.code === "42P01" || err?.code === "42703") return [];
            throw err;
        }
    },

    // Ordered the way the booking page browses them — by the salon's own
    // category ordering, then name — rather than by creation date, which is
    // meaningless to a customer scrolling a 500-service catalogue.
    //
    // `booking_count` is how many appointments this service actually appears
    // on, used for the "Most booked" shortcut. Real usage, not a guess: a
    // catalogue this size is unusable without a way in.
    async findActiveServices(salonId: string) {
        // BUG-OB-DM-01: Online Booking used to show every active, bookable
        // catalog service regardless of the salon's Digital Menu curation — a
        // salon that configured a specific 7-service selection there still
        // saw its whole catalog on the public booking page. Digital Menu's
        // own selection (digital_menu_services, mode = 'specific') is now the
        // same source of truth here; mode = 'all_active' or no menu row at
        // all (never configured) keeps today's unfiltered behavior.
        const menu = await digitalMenuRepository.findBySalonId(salonId);
        const specific = menu?.service_selection_mode === "specific";

        const { rows } = await pool.query(
            `SELECT s.id, s.name, s.description, s.price, s.price_type,
                    s.duration_minutes AS duration,
                    s.category_id,
                    COALESCE(NULLIF(TRIM(c.name), ''), 'Other') AS category_name,
                    NULLIF(TRIM(COALESCE(s.image_url, '')), '') AS image_url,
                    COALESCE(b.booking_count, 0)::int AS booking_count
             FROM services s
             LEFT JOIN service_categories c ON c.id = s.category_id
             LEFT JOIN (
                 SELECT service_id, COUNT(*) AS booking_count
                 FROM appointments
                 WHERE salon_id = $1
                   AND service_id IS NOT NULL
                   AND status NOT IN ('cancelled', 'deleted')
                 GROUP BY service_id
             ) b ON b.service_id = s.id
             ${specific ? "JOIN digital_menu_services dms ON dms.service_id = s.id AND dms.menu_id = $2" : ""}
             WHERE s.salon_id = $1 AND s.is_active = true AND s.online_booking = true
             ORDER BY COALESCE(c.display_order, 2147483647), c.name NULLS LAST, s.name ASC`,
            specific ? [salonId, menu!.id] : [salonId]
        );
        return rows;
    },

    // Per-salon brand colours/fonts for the public booking page, so it reads as
    // the salon's rather than ours. The table is currently empty across the
    // board — its editing UI was removed — so in practice this returns null and
    // the page falls back to its neutral palette. Wired anyway: the moment a
    // brand kit is populated the booking page picks it up with no code change.
    // Tolerates the table being absent on an environment that's behind.
    async findBrandKit(salonId: string) {
        try {
            const { rows } = await pool.query(
                `SELECT primary_color, secondary_color, accent_color, text_color,
                        heading_font, body_font
                 FROM salon_brand_kits WHERE salon_id = $1`,
                [salonId]
            );
            return rows[0] || null;
        } catch (err: any) {
            if (err?.code === UNDEFINED_TABLE || err?.code === UNDEFINED_COLUMN) return null;
            throw err;
        }
    },

    // The accent colour the salon picked in Online Booking > Theme Colour
    // ("#rrggbb"), or null for the page's default palette. Tolerates the column
    // not existing yet (Migration/add_marketplace_theme_color.sql not run).
    async findThemeColor(salonId: string): Promise<string | null> {
        try {
            const { rows } = await pool.query(
                `SELECT theme_color FROM marketplace_profiles WHERE salon_id = $1`,
                [salonId]
            );
            return rows[0]?.theme_color ?? null;
        } catch (err: any) {
            if (err?.code === UNDEFINED_TABLE || err?.code === UNDEFINED_COLUMN) return null;
            throw err;
        }
    },

    // Custom title/subtitle for the public booking page's first step (Online
    // Booking > Page Heading); nulls mean "use the built-in wording". Tolerates
    // the columns not existing yet (Migration/add_marketplace_booking_headline.sql).
    async findBookingHeadline(salonId: string): Promise<{ booking_headline: string | null; booking_subheadline: string | null }> {
        try {
            const { rows } = await pool.query(
                `SELECT booking_headline, booking_subheadline FROM marketplace_profiles WHERE salon_id = $1`,
                [salonId]
            );
            return {
                booking_headline: rows[0]?.booking_headline ?? null,
                booking_subheadline: rows[0]?.booking_subheadline ?? null,
            };
        } catch (err: any) {
            if (err?.code === UNDEFINED_TABLE || err?.code === UNDEFINED_COLUMN) {
                return { booking_headline: null, booking_subheadline: null };
            }
            throw err;
        }
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
               -- Simple rule: every ACTIVE staff member is shown online. The
               -- "Show in Online Booking" toggle and the service_staff mapping
               -- no longer hide anyone (the ids parameter is kept only so callers don't change).
               AND ($2::uuid[] IS NULL OR TRUE)
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
               AND ($3::uuid[] IS NULL OR TRUE)
             LIMIT 1`,
            [staffId, salonId, ids]
        );
        return rows.length > 0;
    },

    // Same Digital Menu gate as findActiveServices, applied at the point a
    // service_id is actually submitted for booking — otherwise a service
    // hidden from a "specific" Digital Menu selection could still be booked
    // by anyone who already had (or guessed) its id, bypassing what the
    // customer was ever shown.
    async findServiceById(id: string, salonId: string) {
        const menu = await digitalMenuRepository.findBySalonId(salonId);
        const specific = menu?.service_selection_mode === "specific";

        const { rows } = await pool.query(
            `SELECT s.id, s.name, s.description, s.price, s.price_type, s.duration_minutes AS duration
             FROM services s
             ${specific ? "JOIN digital_menu_services dms ON dms.service_id = s.id AND dms.menu_id = $3" : ""}
             WHERE s.id = $1 AND s.salon_id = $2 AND s.is_active = true`,
            specific ? [id, salonId, menu!.id] : [id, salonId]
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
        const tz = await getSalonTimezone(salonId);
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
            [salonId, dateStr, tz]
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
        const tz = await getSalonTimezone(params.salonId);
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
            [params.salonId, params.staffId, params.dateStr, params.startMinute, params.endMinute, params.excludeId ?? null, tz]
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
        isAnyStaff?: boolean;
        serviceId: string;
        title: string;
        scheduledAt: string;
        durationMinutes: number;
        notes?: string | null;
        services: unknown[];
    }, client?: import("pg").PoolClient) {
        const { rows } = await (client ?? pool).query(
            `WITH n AS (
              INSERT INTO salon_booking_counters (salon_id, last_number) VALUES ($1, 1)
              ON CONFLICT (salon_id) DO UPDATE SET last_number = salon_booking_counters.last_number + 1
              RETURNING last_number
            )
            INSERT INTO appointments (
                salon_id, client_id, staff_id, service_id,
                title, notes, status,
                scheduled_at, duration_minutes,
                ends_at,
                colour, created_by,
                services, source, is_any_staff, booking_number
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9,
                ($8::timestamptz + ($9::integer * INTERVAL '1 minute')),
                $10, $11,
                $12::jsonb, $13, $14, (SELECT last_number FROM n)
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
                "online_booking",
                params.isAnyStaff ?? false,
            ]
        );
        return rows[0];
    },
};
