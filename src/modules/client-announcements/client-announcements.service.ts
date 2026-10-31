import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { clientsService } from "../clients/clients.service";
import { listOwnerContacts, splitPhone } from "./announcement-audience";
import { ensurePlatformSalon, getPlatformSalonId } from "./platform-salon";

const migrationError = () => new AppError(409, "Run Migration/create_platform_announcement_settings.sql on this database first.", "MIGRATION_MISSING");

export const clientAnnouncementsService = {
    // Where things stand: which salon is the platform salon, whether its Meta account is connected, how many owners are synced in.
    // Also creates the hidden platform salon the first time, so there is nothing to set up by hand.
    async getSetup(superAdminUserId: string) {
        let salonId: string;
        try {
            salonId = await ensurePlatformSalon(superAdminUserId);
        } catch (err: any) {
            if (err?.code === "42P01") throw migrationError();
            throw err;
        }

        const [{ rows: salon }, { rows: wa }, { rows: clients }] = await Promise.all([
            pool.query(`SELECT COALESCE(business_name, slug, 'Unnamed') AS name FROM salons WHERE id::text = $1`, [salonId]),
            pool.query(`SELECT phone_number_id, display_phone, is_verified FROM whatsapp_configs WHERE salon_id::text = $1 LIMIT 1`, [salonId]),
            pool.query(`SELECT COUNT(*)::int AS n FROM clients WHERE salon_id::text = $1 AND is_active = true`, [salonId]),
        ]);
        return {
            salonId,
            salonName: salon[0]?.name ?? null,
            whatsappConnected: !!wa[0]?.phone_number_id,
            whatsappPhone: wa[0]?.display_phone ?? null,
            ownerCount: clients[0]?.n ?? 0,
        };
    },

    // Copies salon owners into the platform salon's client list, which is what the campaign screens pick contacts from.
    // Safe to repeat: a number or email that is already there is left alone.
    async syncOwners() {
        const platformSalonId = await getPlatformSalonId();
        if (!platformSalonId) throw new AppError(400, "Choose the platform salon first.", "PLATFORM_SALON_NOT_SET");

        const { owners, withoutPhone } = await listOwnerContacts(platformSalonId);
        let created = 0;
        let existing = 0;
        const failed: { salonName: string; ownerName: string; reason: string }[] = [];

        for (const o of owners) {
            const parts = (o.ownerName || o.salonName).split(/\s+/).filter(Boolean);
            const { code, number } = splitPhone(o.phone);
            try {
                await clientsService.create({
                    first_name: parts[0] ?? o.salonName,
                    last_name: parts.slice(1).join(" ") || null,
                    email: o.email,
                    phone_country_code: code,
                    phone_number: number,
                    has_whatsapp: true,
                    client_source: "SalonOx owner",
                    source_description: o.salonName,
                } as any, platformSalonId);
                created++;
            } catch (err: any) {
                if (err?.code === "DUPLICATE_PHONE" || err?.code === "DUPLICATE_EMAIL") { existing++; continue; }
                failed.push({ salonName: o.salonName, ownerName: o.ownerName, reason: err?.message ?? "Could not add" });
            }
        }
        logger.info("[client-announcements] owners synced", { platformSalonId, created, existing, failed: failed.length });
        return { total: owners.length, created, existing, failed, withoutPhone };
    },
};
