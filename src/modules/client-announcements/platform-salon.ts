import pool from "../../config/database";

// Which salon holds SalonOx's own Meta account for Client Announcements. Read on every Super Admin marketing request, so
// it is cached briefly. null = not chosen yet (or the migration has not been run).
let cache: { at: number; salonId: string | null } | null = null;

export async function getPlatformSalonId(): Promise<string | null> {
    if (cache && Date.now() - cache.at < 30_000) return cache.salonId;
    let salonId: string | null = null;
    try {
        const { rows } = await pool.query(`SELECT salon_id FROM platform_announcement_settings WHERE id = TRUE`);
        salonId = rows[0]?.salon_id ?? null;
    } catch (err: any) {
        if (err?.code !== "42P01") throw err;
    }
    cache = { at: Date.now(), salonId };
    return salonId;
}

// The platform salon, created the first time it is needed. It is an ordinary salon row owned by the super admin who opened
// Client Announcements (so no extra user account exists), hidden from the Super Admin salon lists. Returns its id.
export async function ensurePlatformSalon(superAdminUserId: string): Promise<string> {
    const existing = await getPlatformSalonId();
    if (existing) {
        const { rows } = await pool.query(`SELECT 1 FROM salons WHERE id::text = $1`, [existing]);
        if (rows[0]) return existing;   // otherwise the salon was deleted: make a new one below
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Two first-time requests at once must not make two salons.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('platform-announcement-salon'))");
        const { rows: current } = await client.query(
            `SELECT s.id::text AS id FROM platform_announcement_settings p JOIN salons s ON s.id::text = p.salon_id WHERE p.id = TRUE`
        );
        let salonId: string = current[0]?.id;
        if (!salonId) {
            const { rows: created } = await client.query(
                `INSERT INTO salons (owner_id, business_name, slug, is_active, onboarding_completed, is_dummy)
                 VALUES ($1, 'SalonOx (Client Announcements)', $2, true, true, false) RETURNING id::text AS id`,
                [superAdminUserId, `salonox-client-announcements-${Date.now()}`]
            );
            salonId = created[0].id;
            await client.query(
                `INSERT INTO platform_announcement_settings (id, salon_id, updated_by, updated_at) VALUES (TRUE, $1, $2, NOW())
                 ON CONFLICT (id) DO UPDATE SET salon_id = $1, updated_by = $2, updated_at = NOW()`,
                [salonId, superAdminUserId]
            );
        }
        await client.query("COMMIT");
        cache = null;
        return salonId;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}

// Super Admin requests to these paths run as the platform salon (see authMiddleware): the Marketing module's own endpoints,
// plus the client search the campaign contact picker uses. Nothing else is reachable this way.
const PLATFORM_PATHS = [
    "/api/v1/templates", "/api/v1/campaigns", "/api/v1/wa-config", "/api/v1/wa-insights",
    "/api/v1/inbox", "/api/v1/marketing", "/api/v1/clients",
];

export const isPlatformPath = (url: string): boolean => {
    const path = url.split("?")[0];
    return PLATFORM_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
};
