// src/modules/clients/clients.service.ts
import { AppError } from "../../middleware/error.middleware";
import { clientsRepository } from "./clients.repository";
import { notificationsService } from "../notifications/notifications.service";
import { salonsRepository } from "../salons/salons.repository";
import { emailService } from "../utils/email.service";
import { canSendEmail } from "../utils/notif-prefs";
import { generateReferralCode } from "../referral/referral.types";
import { paymentsRepository } from "../payments/payments.repository";
import { clientPackagesService } from "../client-packages/client-packages.service";
import { clientMembershipsService } from "../client-memberships/client-memberships.service";
import { membershipsService } from "../memberships/memberships.service";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { waScheduledMessagesService } from "../whatsapp-automation/wa-scheduled-messages.service";
import pool from "../../config/database";
import logger from "../../config/logger";
import {
    Client,
    ClientWithRelations,
    CreateClientBody,
    UpdateClientBody,
    ClientsListQuery,
    ClientsImportMode,
    ClientsImportResult,
    ClientsMergeBody,
    MergeStrategy,
} from "./clients.types";

const safeTrim = (v: any) => (v === null || v === undefined ? v : String(v).trim());

// Regenerates with an incrementing suffix until the code is free within this
// salon — the base code is time-based (not random), so collisions are
// expected when two same-initial customers join in the same clock hour.
export async function generateUniqueReferralCode(name: string, salonId: string): Promise<string> {
    const base = generateReferralCode(name);
    let candidate = base;
    let suffix = 0;
    while (await clientsRepository.isReferralCodeTaken(candidate, salonId)) {
        suffix += 1;
        candidate = `${base}${suffix}`;
    }
    return candidate;
}

const normalizeCreateBody = (b: CreateClientBody): CreateClientBody => ({
    ...b,
    first_name: safeTrim(b.first_name),
    last_name: safeTrim(b.last_name),
    email: b.email ? safeTrim(b.email) : b.email ?? null,
    phone_country_code: b.phone_country_code ? safeTrim(b.phone_country_code) : b.phone_country_code ?? null,
    phone_number: b.phone_number ? safeTrim(b.phone_number) : b.phone_number ?? null,
    additional_email: b.additional_email ? safeTrim(b.additional_email) : b.additional_email ?? null,
    additional_phone_country_code: b.additional_phone_country_code ? safeTrim(b.additional_phone_country_code) : b.additional_phone_country_code ?? null,
    additional_phone_number: b.additional_phone_number ? safeTrim(b.additional_phone_number) : b.additional_phone_number ?? null,
    birthday_day_month: b.birthday_day_month ? safeTrim(b.birthday_day_month) : b.birthday_day_month ?? null,
    preferred_language: b.preferred_language ? safeTrim(b.preferred_language) : b.preferred_language ?? null,
    occupation: b.occupation ? safeTrim(b.occupation) : b.occupation ?? null,
    country: b.country ? safeTrim(b.country) : b.country ?? null,
    avatar_url: b.avatar_url ? safeTrim(b.avatar_url) : b.avatar_url ?? null,
    client_source: b.client_source ? safeTrim(b.client_source) : b.client_source ?? null,
    gender: b.gender ? safeTrim(b.gender) : b.gender ?? null,
    pronouns: b.pronouns ? safeTrim(b.pronouns) : b.pronouns ?? null,
    address: b.address ? safeTrim(b.address) : b.address ?? null,
});

// Fetches the packages/memberships/history/loyalty sub-resources requested
// via `include` and attaches them onto `result` in place. Packages/
// memberships are fetched unfiltered (no status, high limit) rather than the
// narrower "active only" params some individual callers used to pass — the
// caller filters client-side for whichever narrower view it needs, so this
// one shared fetch can serve every consumer instead of each running its own
// differently-filtered request.
async function attachExtendedProfile(
    result: ClientWithRelations,
    clientId: string,
    salonId: string,
    includeSet: Set<string>,
): Promise<void> {
    const [packagesRes, membershipsRes, apptStatsRes, revenueRes, loyaltyRes, staffAlertRes] = await Promise.all([
        includeSet.has("packages")
            ? clientPackagesService.list(salonId, { clientId, limit: 500 })
            : Promise.resolve(null),
        includeSet.has("memberships")
            ? clientMembershipsService.list(salonId, { clientId, limit: 200 })
            : Promise.resolve(null),
        // Two independent queries — same split clientsController.getHistory uses
        // (its "stats" + "lifetime spend" legs) — rather than one JOIN, since an
        // appointment can carry more than one payments row and a naive join
        // would multiply the appointment counts by however many payments it has.
        includeSet.has("history")
            ? pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE a.status IN ('paid','partial'))::int AS total_visits,
                    COUNT(*) FILTER (WHERE a.status = 'cancelled')::int         AS cancelled_count
                 FROM appointments a
                 WHERE a.client_id = $1 AND a.salon_id = $2 AND a.deleted_at IS NULL`,
                [clientId, salonId],
            )
            : Promise.resolve(null),
        includeSet.has("history")
            ? pool.query(
                `SELECT COALESCE(SUM(
                    GREATEST(0, paid_amount - COALESCE(ewallet_used, 0) - COALESCE(membership_wallet_used, 0))
                 ), 0) AS total_revenue
                 FROM payments
                 WHERE client_id = $1 AND salon_id = $2 AND status IN ('completed', 'partial')`,
                [clientId, salonId],
            )
            : Promise.resolve(null),
        includeSet.has("loyalty")
            ? membershipsService.getLoyaltyEligibility(clientId, salonId)
            : Promise.resolve(null),
        // Latest non-empty staff_alert and notes, picked independently — an
        // alert set two visits ago can still be the current one even if the
        // most recent visit's own notes field happens to be empty, so this
        // isn't just "read the latest appointment's two columns".
        //
        // Ordered by updated_at (when the field was actually typed/saved),
        // NOT scheduled_at (when the visit itself is booked for) — every
        // appointment save sets updated_at = NOW() (see
        // appointments.repository.ts's update()), so this reflects "whichever
        // alert staff entered most recently" rather than "whichever
        // appointment happens to be scheduled furthest in the future", which
        // could surface a stale alert over one just entered on an earlier-
        // dated visit.
        includeSet.has("staffAlert")
            ? pool.query(
                `SELECT
                    (SELECT staff_alert  FROM appointments WHERE client_id = $1 AND salon_id = $2 AND deleted_at IS NULL AND staff_alert IS NOT NULL AND staff_alert <> '' ORDER BY updated_at DESC LIMIT 1) AS staff_alert,
                    (SELECT updated_at   FROM appointments WHERE client_id = $1 AND salon_id = $2 AND deleted_at IS NULL AND staff_alert IS NOT NULL AND staff_alert <> '' ORDER BY updated_at DESC LIMIT 1) AS staff_alert_at,
                    (SELECT notes        FROM appointments WHERE client_id = $1 AND salon_id = $2 AND deleted_at IS NULL AND notes IS NOT NULL AND notes <> '' ORDER BY updated_at DESC LIMIT 1) AS notes,
                    (SELECT updated_at   FROM appointments WHERE client_id = $1 AND salon_id = $2 AND deleted_at IS NULL AND notes IS NOT NULL AND notes <> '' ORDER BY updated_at DESC LIMIT 1) AS notes_at`,
                [clientId, salonId],
            )
            : Promise.resolve(null),
    ]);

    if (packagesRes) result.packages = packagesRes.items;
    if (membershipsRes) result.memberships = membershipsRes.items;
    if (apptStatsRes && revenueRes) {
        const statsRow = apptStatsRes.rows[0] ?? {};
        const revenueRow = revenueRes.rows[0] ?? {};
        result.history = {
            total_visits: Number(statsRow.total_visits ?? 0),
            cancelled_count: Number(statsRow.cancelled_count ?? 0),
            total_revenue: Number(revenueRow.total_revenue ?? 0),
        };
    }
    if (includeSet.has("loyalty")) result.loyalty_eligibility = loyaltyRes ?? null;
    if (includeSet.has("staffAlert")) {
        const row = staffAlertRes?.rows[0] ?? {};
        result.latest_staff_alert = row.staff_alert ? { text: row.staff_alert, date: row.staff_alert_at } : null;
        result.latest_notes = row.notes ? { text: row.notes, date: row.notes_at } : null;
    }
}

export const clientsService = {
    async list(query: ClientsListQuery, salonId: string) {
        return clientsRepository.list(query, salonId);
    },

    async create(body: CreateClientBody, salonId: string, include?: string): Promise<ClientWithRelations> {
        const normalized = normalizeCreateBody(body);

        // One active client per phone number (almost always a duplicate/mistake
        // under a different name, not two real clients) and one per email —
        // checked proactively here (rather than only relying on the DB's
        // ux_clients_salon_email unique index) so the caller gets a specific,
        // field-attributable error instead of a raw 23505 constraint violation
        // caught generically by the error middleware. Combined into a single
        // round trip (was two sequential SELECTs) since both checks always run
        // together on create.
        if (normalized.phone_number || normalized.email) {
            const { phoneMatch, emailMatch } = await clientsRepository.findActiveByPhoneOrEmail(
                normalized.phone_number, normalized.email, salonId,
            );
            if (phoneMatch) {
                throw new AppError(409, `This phone number is already registered to ${phoneMatch.full_name}`, "DUPLICATE_PHONE");
            }
            if (emailMatch) {
                throw new AppError(409, "This email address is already registered. Please use a different email address.", "DUPLICATE_EMAIL");
            }
        }

        // Referral codes only ever apply at creation (a client's first visit) —
        // there is no later "add/edit referral code" path, by design.
        let referredByClientId = normalized.referred_by_client_id ?? null;
        if (body.referred_by_code && body.referred_by_code.trim()) {
            const code = body.referred_by_code.trim().toUpperCase();
            const referrer = await clientsRepository.findByReferralCode(code, salonId);
            if (!referrer) throw new AppError(400, "Invalid referral code", "VALIDATION_ERROR");
            referredByClientId = referrer.id;
        }
        normalized.referred_by_client_id = referredByClientId;

        const referralCode = await generateUniqueReferralCode(
            normalized.first_name || normalized.last_name || "CLI",
            salonId,
        );

        const created = await clientsRepository.create(normalized, salonId, {
            code: referralCode,
            rewardStatus: referredByClientId ? "pending" : null,
        });

        const [insertedAddresses, insertedEmergencyContacts] = await Promise.all([
            body.addresses?.length ? clientsRepository.replaceUpsertAddresses(created.id, body.addresses, true) : Promise.resolve([]),
            body.emergency_contacts?.length ? clientsRepository.replaceUpsertEmergencyContacts(created.id, body.emergency_contacts, true) : Promise.resolve([]),
        ]);

        // Fire notification (fire-and-forget)
        notificationsService.create({
            salon_id: salonId,
            type:     "client",
            title:    "New Client Added",
            body:     `${created.first_name} ${created.last_name ?? ""}`.trim(),
            event_key: "newClient",
        }).catch((err: any) => {
            logger.error("New client notification failed", {
                clientId: created.id,
                salonId,
                message: err?.message,
                stack: err?.stack,
                error: err,
            });
        });

        // ── WhatsApp Automation: New Client Welcome ───────────────────────────
        if (created.phone_number) {
            (async () => {
                try {
                    const salon = await salonsRepository.findById(salonId);
                    whatsappAutomationService.trigger({
                        salonId,
                        eventType:     "client_welcome",
                        clientId:      created.id,
                        phone:         created.phone_number!,
                        countryCode:   created.phone_country_code ?? null,
                        variables: {
                            "1": `${created.first_name} ${created.last_name ?? ""}`.trim() || "there",
                            "2": salon?.business_name ?? "our salon",
                        },
                        referenceId:   created.id,
                        referenceType: "client",
                        dedupeByReference: true,
                    }).catch(() => {});
                } catch (err: any) {
                    logger.error("[WA-AUTO] client_welcome trigger failed:", err?.message ?? err);
                }
            })();
        }

        // ── Scheduled Templates: birthday_wishes ──────────────────────────────
        // Self-perpetuating after the first send — see wa-scheduled-messages.
        // service.ts's executeScheduledRow(), which re-schedules +1 year on
        // every successful send, so this is the only place a birthday row is
        // ever created from scratch.
        if (created.phone_number && created.birthday_day_month) {
            (async () => {
                try {
                    const salon = await salonsRepository.findById(salonId);
                    await waScheduledMessagesService.scheduleBirthday({
                        salonId, clientId: created.id, phone: created.phone_number!, countryCode: created.phone_country_code ?? null,
                        fullName: `${created.first_name} ${created.last_name ?? ""}`.trim() || "there",
                        salonName: salon?.business_name ?? "our salon",
                        birthdayDayMonth: created.birthday_day_month!,
                    });
                } catch (err: any) {
                    logger.error("[wa-scheduled] birthday_wishes schedule failed:", err?.message ?? err);
                }
            })();
        }

        // ── Email: New Client (to salon owner) ────────────────────────────────
        ;(async () => {
            try {
                const salon = await salonsRepository.findById(salonId);
                const ownerEmail = await salonsRepository.findOwnerEmailById(salonId);
                if (!ownerEmail) { logger.warn("[email] newClient: owner has no email, skipping"); return; }
                logger.info(`[email] newClient → to=${ownerEmail} salon=${salonId}`);
                const allowed = await canSendEmail(salonId, "newClient");
                if (!allowed) { logger.info("[email] newClient: skipped (preference off)"); return; }
                await emailService.sendNewClientEmail({
                    to:          ownerEmail,
                    salonName:   salon?.business_name ?? "your salon",
                    clientName:  `${created.first_name} ${created.last_name ?? ""}`.trim(),
                    clientEmail: created.email       ?? undefined,
                    clientPhone: created.phone_number ?? undefined,
                });
                logger.info(`[email] newClient sent to ${ownerEmail}`);
            } catch (err: any) { logger.error("[email] newClient failed:", err?.message ?? err); }
        })();

        // Build the response from what's already in hand (created's RETURNING *,
        // plus the just-inserted relation rows) instead of re-SELECTing the row
        // we just wrote — was an extra findById + 2 relation queries that only
        // ever re-read data this function already had.
        const withRel: ClientWithRelations = {
            ...created,
            addresses: insertedAddresses,
            emergency_contacts: insertedEmergencyContacts,
        };

        // A brand-new client has no packages/memberships/visits/loyalty-unlock
        // yet — seed empty/zeroed values instead of running the same queries
        // getById's `include` handling would (which are guaranteed to return
        // nothing for a client that was just created), so the caller doesn't
        // need a follow-up GET just to learn "this client has nothing yet".
        if (include) {
            const includeSet = new Set(String(include).split(",").map((s) => s.trim()).filter(Boolean));
            if (includeSet.has("packages")) withRel.packages = [];
            if (includeSet.has("memberships")) withRel.memberships = [];
            if (includeSet.has("history")) withRel.history = { total_visits: 0, cancelled_count: 0, total_revenue: 0 };
            if (includeSet.has("loyalty")) withRel.loyalty_eligibility = null;
        }

        return withRel;
    },

    async getById(clientId: string, salonId: string, include?: string): Promise<ClientWithRelations> {
        const includeSet = new Set(
            String(include || "").split(",").map((s) => s.trim()).filter(Boolean)
        );

        const client = await clientsRepository.findById(clientId, salonId);
        if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

        const referralStats = await clientsRepository.getReferralStats(clientId);
        const referredBy = client.referred_by_client_id
            ? await clientsRepository.getReferrerInfo(client.referred_by_client_id)
            : null;
        const result: ClientWithRelations = { ...client, ...referralStats, referred_by: referredBy } as any;
        if (includeSet.has("addresses") || includeSet.has("emergency_contacts")) {
            const rel = await clientsRepository.getRelations(clientId);
            if (includeSet.has("addresses")) result.addresses = rel.addresses;
            if (includeSet.has("emergency_contacts")) result.emergency_contacts = rel.emergency_contacts;
        }

        // ?include=packages,memberships,history,loyalty — added so a caller
        // that needs this client's full profile (Quick Sale / booking modal
        // selecting a client) gets everything in this one request instead of
        // separately hitting /client-packages, /client-memberships,
        // /clients/:id/history, and /memberships/loyalty-eligibility right
        // after. Each sub-fetch runs only when actually requested, and all
        // requested ones run concurrently.
        if (includeSet.has("packages") || includeSet.has("memberships") || includeSet.has("history") || includeSet.has("loyalty") || includeSet.has("staffAlert")) {
            await attachExtendedProfile(result, clientId, salonId, includeSet);
        }

        return result;
    },

    async update(clientId: string, patch: UpdateClientBody, salonId: string): Promise<ClientWithRelations> {
        const exists = await clientsRepository.findById(clientId, salonId);
        if (!exists) throw new AppError(404, "Client not found", "NOT_FOUND");

        // Only re-check when the phone is actually changing — editing an
        // unrelated field on a client shouldn't trip over their own number.
        if (patch.phone_number && patch.phone_number.trim() !== (exists.phone_number || "").trim()) {
            const dup = await clientsRepository.findActiveByPhone(
                patch.phone_number, salonId, clientId,
            );
            if (dup) {
                throw new AppError(409, `This phone number is already registered to ${dup.full_name}`, "DUPLICATE_PHONE");
            }
        }

        // Same for email — only re-check when it's actually changing.
        if (patch.email && patch.email.trim().toLowerCase() !== (exists.email || "").trim().toLowerCase()) {
            const dupEmail = await clientsRepository.findActiveByEmail(patch.email, salonId, clientId);
            if (dupEmail) {
                throw new AppError(409, "This email address is already registered. Please use a different email address.", "DUPLICATE_EMAIL");
            }
        }

        // Referral codes can be applied post-creation too (e.g. at checkout, via
        // "Referred by" on the payment panel) — but only once, and only before
        // the client's first completed payment. Handled here rather than in the
        // generic column whitelist below so a normal PATCH can never set
        // referral_reward_status directly.
        if (patch.referred_by_code && patch.referred_by_code.trim()) {
            if (exists.referred_by_client_id) {
                throw new AppError(400, "A referral code has already been applied to this client", "VALIDATION_ERROR");
            }
            const completedCount = await paymentsRepository.countCompletedForClient(clientId);
            if (completedCount > 0) {
                throw new AppError(400, "Referral codes can only be applied before the client's first payment", "VALIDATION_ERROR");
            }
            const code = patch.referred_by_code.trim().toUpperCase();
            const referrer = await clientsRepository.findByReferralCode(code, salonId);
            if (!referrer) throw new AppError(400, "Invalid referral code", "VALIDATION_ERROR");
            if (referrer.id === clientId) throw new AppError(400, "A client cannot refer themselves", "VALIDATION_ERROR");
            await clientsRepository.linkReferrer(clientId, referrer.id);
        }
        delete (patch as any).referred_by_code;

        const updated = await clientsRepository.update(clientId, patch, salonId);

        if (patch.addresses) await clientsRepository.replaceUpsertAddresses(clientId, patch.addresses);
        if (patch.emergency_contacts) await clientsRepository.replaceUpsertEmergencyContacts(clientId, patch.emergency_contacts);

        const withRel = await clientsRepository.getByIdWithRelations(updated.id, salonId);

        // A birthday added/changed after the client's own creation (it wasn't
        // required at signup) needs its own schedule row too — create()'s own
        // hook only fires once, at creation, so without this a client who adds
        // their birthday later would never get one.
        if (patch.birthday_day_month && withRel?.phone_number) {
            (async () => {
                try {
                    const salon = await salonsRepository.findById(salonId);
                    await waScheduledMessagesService.scheduleBirthday({
                        salonId, clientId, phone: withRel.phone_number!, countryCode: withRel.phone_country_code ?? null,
                        fullName: `${withRel.first_name} ${withRel.last_name ?? ""}`.trim() || "there",
                        salonName: salon?.business_name ?? "our salon",
                        birthdayDayMonth: patch.birthday_day_month!,
                    });
                } catch (err: any) {
                    logger.error("[wa-scheduled] birthday_wishes reschedule-on-edit failed:", err?.message ?? err);
                }
            })();
        }

        return withRel as ClientWithRelations;
    },

    async remove(clientId: string, salonId: string, hard?: boolean): Promise<void> {
        const exists = await clientsRepository.findById(clientId, salonId);
        if (!exists) throw new AppError(404, "Client not found", "NOT_FOUND");

        if (hard) await clientsRepository.hardDelete(clientId, salonId);
        else await clientsRepository.softDelete(clientId, salonId);
        waScheduledMessagesService.cancelForReference('client', clientId)
            .catch((err: any) => logger.error("[wa-scheduled] cancel-on-delete failed:", err?.message ?? err));
    },

    async blockClients(ids: string[], reason: string, salonId: string): Promise<void> {
        if (!ids?.length) return;
        await clientsRepository.blockClients(ids, reason, salonId);
    },

    async unblockClients(ids: string[], salonId: string): Promise<void> {
        if (!ids?.length) return;
        await clientsRepository.unblockClients(ids, salonId);
    },

    // ---------------- IMPORT ----------------
    async importClients(params: {
        rows: Array<any>;
        /** @deprecated Imports always skip duplicates (create_only). This param is accepted but ignored. */
        mode: ClientsImportMode;
        dry_run: boolean;
        salonId: string;
    }): Promise<ClientsImportResult> {
        const result: ClientsImportResult = {
            total_rows: params.rows.length,
            imported: 0,
            updated: 0,
            skipped: 0,
            errors: [],
        };

        // Normalize CSV row: build a lowercase-keyed copy (spaces → underscore) so column
        // matching works regardless of how the user named their columns (e.g. "Mobile Number"
        // or "mobile" or "Phone" all resolve to the same lookup key).
        const normalizeRow = (r: any): Record<string, any> => {
            const out: Record<string, any> = { ...r };
            for (const [k, v] of Object.entries(r)) {
                const lk = k.toLowerCase().replace(/\s+/g, '_');
                out[lk] = v;
            }
            return out;
        };

        // Blank cell → undefined (caller applies the Add Client form's own
        // default for that field); anything else is read the same way a
        // spreadsheet author would type it — yes/y/true/1 or no/n/false/0.
        const toBool = (v: any): boolean | undefined => {
            if (v === undefined || v === null || String(v).trim() === "") return undefined;
            const s = String(v).trim().toLowerCase();
            if (["true", "yes", "y", "1"].includes(s)) return true;
            if (["false", "no", "n", "0"].includes(s)) return false;
            return undefined;
        };

        // Same day/month/year split AddClientPage.tsx makes from its native date
        // input's "YYYY-MM-DD" value — accepts that or the more common
        // spreadsheet format "DD-MM-YYYY" (also "DD/MM/YYYY"), so an imported
        // date lands on birthday_day_month/birthday_year exactly the way a
        // manual Add/Edit save would populate them. `iso` is only used locally
        // here (e.g. the "birthday can't be in the future" check).
        const splitDate = (raw: any): { dayMonth: string | null; year: number | null; iso: string | null } => {
            const s = String(raw ?? "").trim();
            if (!s) return { dayMonth: null, year: null, iso: null };
            const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
            const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
            let y: number, m: number, d: number;
            if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
            else if (dmy) { d = Number(dmy[1]); m = Number(dmy[2]); y = Number(dmy[3]); }
            else return { dayMonth: null, year: null, iso: null };
            if (m < 1 || m > 12 || d < 1 || d > 31) return { dayMonth: null, year: null, iso: null };
            const mm = String(m).padStart(2, "0");
            const dd = String(d).padStart(2, "0");
            return { dayMonth: `${mm}-${dd}`, year: y, iso: `${y}-${mm}-${dd}` };
        };

        const GSTIN_FORMAT_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
        const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const today = new Date().toISOString().slice(0, 10);

        // Every field the Client Add/Edit form (AddClientPage.tsx) can save —
        // an import row can populate anything that form can, not just the
        // original name/phone/gender/birthday subset.
        const toBody = (raw: any): CreateClientBody => {
            const r = normalizeRow(raw);
            const phoneVal = r.mobile ?? r.phone_number ?? r.mobile_number ?? r.phone ?? null;
            const additionalPhoneVal =
                r.additionalmobile ?? r.additional_mobile ?? r.additionalphone ?? r.additional_phone ?? r.additional_phone_number ?? null;
            const birthday = splitDate(r.birthday ?? r.dob ?? r.date_of_birth);
            const anniversary = splitDate(r.anniversary);
            const gst = r.gstnumber ?? r.gst_number;
            const zip = r.zipcode ?? r.zip_code ?? r.pincode;
            const creditLimitRaw = r.creditlimit ?? r.credit_limit;
            const creditDurationRaw = r.creditduration ?? r.credit_duration ?? r.credit_duration_days;

            return {
                first_name: String(r.firstname ?? r.first_name ?? "").trim(),
                last_name: (r.lastname ?? r.last_name) ? String(r.lastname ?? r.last_name).trim() : null,
                email: r.email ? String(r.email).trim() : null,
                phone_country_code: "+91",
                phone_number: phoneVal != null && String(phoneVal).trim() ? String(phoneVal).trim() : null,
                additional_email: null,
                additional_phone_country_code: additionalPhoneVal ? "+91" : null,
                additional_phone_number: additionalPhoneVal ? String(additionalPhoneVal).trim() : null,
                birthday_day_month: birthday.dayMonth,
                birthday_year: birthday.year,
                anniversary: anniversary.iso,
                gender: r.gender ? String(r.gender).trim() : null,
                pronouns: null,
                address: (r.address) ? String(r.address).trim() : null,
                state: r.state ? String(r.state).trim() : null,
                pincode: zip ? String(zip).trim() : null,
                gst_number: gst ? String(gst).trim().toUpperCase() : null,
                client_code: (r.clientcode ?? r.client_code) ? String(r.clientcode ?? r.client_code).trim() : null,
                identification_number: (r.identificationnumber ?? r.identification_number)
                    ? String(r.identificationnumber ?? r.identification_number).trim() : null,
                credit_limit: creditLimitRaw !== undefined && String(creditLimitRaw).trim() !== "" ? Number(creditLimitRaw) : 0,
                credit_duration_days: creditDurationRaw !== undefined && String(creditDurationRaw).trim() !== "" ? Number(creditDurationRaw) : 0,
                lead_source: (r.leadsource ?? r.lead_source) ? String(r.leadsource ?? r.lead_source).trim() : null,
                source_description: (r.sourcedescription ?? r.source_description)
                    ? String(r.sourcedescription ?? r.source_description).trim() : null,
                has_whatsapp: toBool(r.haswhatsapp ?? r.has_whatsapp) ?? true,
                client_source: (r.clientsource ?? r.client_source) ? String(r.clientsource ?? r.client_source).trim() : null,
                referred_by_code: (r.referredbycode ?? r.referred_by_code) ? String(r.referredbycode ?? r.referred_by_code).trim() : null,
                preferred_language: null,
                occupation: null,
                country: null,
                avatar_url: null,
                sms_marketing: toBool(r.smsmarketing ?? r.sms_marketing) ?? true,
                email_marketing: toBool(r.emailmarketing ?? r.email_marketing) ?? true,
                whatsapp_marketing: toBool(r.whatsappmarketing ?? r.whatsapp_marketing) ?? true,
                sms_notifications: toBool(r.smsnotifications ?? r.sms_notifications) ?? true,
                email_notifications: toBool(r.emailnotifications ?? r.email_notifications) ?? true,
                whatsapp_notifications: toBool(r.whatsappnotifications ?? r.whatsapp_notifications) ?? false,
            };
        };

        // Track phone numbers and emails seen in this batch to catch within-file duplicates
        const seenPhones = new Set<string>();
        const seenEmails = new Set<string>();

        for (let i = 0; i < params.rows.length; i++) {
            const rowNum = i + 1;
            try {
                const body = normalizeCreateBody(toBody(params.rows[i]));
                // Reassembled from the already-split fields rather than re-parsing
                // the raw cell — same value toBody's splitDate produced.
                const birthdayIso = body.birthday_day_month && body.birthday_year
                    ? `${body.birthday_year}-${body.birthday_day_month}`
                    : null;

                // ── Required fields — same rule as AddClientPage.tsx's handleSave ──
                if (!body.first_name) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "First name is required" });
                    continue;
                }
                if (!body.phone_number) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Phone number is required" });
                    continue;
                }
                // Excel-style separators (spaces, dashes, parens, dots) are
                // tolerated, but after stripping them the number must be
                // exactly 10 digits — same /^\d{10}$/ the Add Client form applies.
                const phoneDigits = String(body.phone_number).replace(/[\s\-().]/g, "");
                if (!/^\d{10}$/.test(phoneDigits)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: `Invalid mobile number "${body.phone_number}". Please enter a valid 10-digit mobile number.` });
                    continue;
                }
                body.phone_number = phoneDigits;
                if (!body.gender) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Gender is required" });
                    continue;
                }

                // ── Optional fields — validated only when present, same as the form ──
                if (body.email && !EMAIL_FORMAT_RE.test(body.email)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: `Invalid email "${body.email}". Enter a valid email address.` });
                    continue;
                }
                if (birthdayIso && birthdayIso > today) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Birthday cannot be in the future" });
                    continue;
                }
                if (body.gst_number && !GSTIN_FORMAT_RE.test(body.gst_number)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: `Invalid GST number "${body.gst_number}". Enter a valid 15-character GSTIN.` });
                    continue;
                }
                if (body.additional_phone_number) {
                    const additionalDigits = String(body.additional_phone_number).replace(/[\s\-().]/g, "");
                    if (!/^\d{10}$/.test(additionalDigits)) {
                        result.skipped += 1;
                        result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: `Invalid additional mobile number "${body.additional_phone_number}". Enter a valid 10-digit number.` });
                        continue;
                    }
                    body.additional_phone_number = additionalDigits;
                    if (additionalDigits === body.phone_number) {
                        result.skipped += 1;
                        result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Additional mobile must be different from the primary mobile" });
                        continue;
                    }
                }
                if (body.credit_limit != null && (!Number.isFinite(body.credit_limit) || body.credit_limit < 0)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Credit limit must be a number >= 0" });
                    continue;
                }
                if (body.credit_duration_days != null && (!Number.isInteger(body.credit_duration_days) || body.credit_duration_days < 0)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: "Credit duration must be a whole number of days >= 0" });
                    continue;
                }

                const phoneKey = body.phone_number?.trim() || null;
                const emailKey = body.email?.toLowerCase().trim() || null;

                // Skip duplicates within this upload batch
                if (phoneKey && seenPhones.has(phoneKey)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "DUPLICATE_IN_BATCH", message: `Phone number ${phoneKey} appears more than once in this file — row skipped` });
                    continue;
                }
                if (emailKey && seenEmails.has(emailKey)) {
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "DUPLICATE_IN_BATCH", message: `Email ${emailKey} appears more than once in this file — row skipped` });
                    continue;
                }

                if (phoneKey) seenPhones.add(phoneKey);
                if (emailKey) seenEmails.add(emailKey);

                // Check against existing records in the database
                const existing = await clientsRepository.findExistingByEmailOrPhone(
                    { email: body.email ?? null, phone_country_code: body.phone_country_code ?? null, phone_number: phoneKey },
                    params.salonId
                );

                if (existing) {
                    // Duplicate found in DB — always skip regardless of mode
                    result.skipped += 1;
                    result.errors.push({ row: rowNum, code: "DUPLICATE_ENTRY", message: `A client with this phone number or email already exists (${existing.full_name}) — row skipped` });
                    continue;
                }

                // A referred_by_code only resolves at creation time, same as
                // the Add Client form — an unknown code fails the row rather
                // than silently importing without the referral link.
                let referredByClientId: string | null = null;
                if (body.referred_by_code && body.referred_by_code.trim()) {
                    const code = body.referred_by_code.trim().toUpperCase();
                    const referrer = await clientsRepository.findByReferralCode(code, params.salonId);
                    if (!referrer) {
                        result.skipped += 1;
                        result.errors.push({ row: rowNum, code: "VALIDATION_ERROR", message: `Invalid referral code "${code}"` });
                        continue;
                    }
                    referredByClientId = referrer.id;
                }
                body.referred_by_client_id = referredByClientId;

                if (!params.dry_run) {
                    const referralCode = await generateUniqueReferralCode(body.first_name, params.salonId);
                    // clientsRepository.create() directly (not clientsService.create())
                    // — deliberately skips the New-Client notification and WhatsApp
                    // welcome message that path fires per client, which would
                    // otherwise blast every existing customer in a bulk CSV import.
                    await clientsRepository.create(body, params.salonId, {
                        code: referralCode,
                        rewardStatus: referredByClientId ? "pending" : null,
                    });
                }
                result.imported += 1;
            } catch (e: any) {
                result.skipped += 1;
                result.errors.push({ row: rowNum, code: e?.code || "IMPORT_ERROR", message: e?.message || "Unknown error" });
            }
        }

        return result;
    },

    async findDuplicatesByPhone(phone_number: string, salonId: string): Promise<Client[]> {
        const cleaned = String(phone_number || "").trim();
        if (!cleaned) throw new AppError(400, "phone_number is required", "VALIDATION_ERROR");
        return clientsRepository.findDuplicatesByPhone(cleaned, salonId);
    },

    async mergeClients(body: ClientsMergeBody, salonId: string) {
        const allIds = [body.target_client_id, ...body.source_client_ids];
        const uniqueIds = Array.from(new Set(allIds));
        if (uniqueIds.length < 2)
            throw new AppError(400, "At least 2 unique client IDs are required to merge", "VALIDATION_ERROR");

        const clients: Client[] = [];
        for (const id of uniqueIds) {
            const c = await clientsRepository.findById(id, salonId);
            if (!c) throw new AppError(404, `Client ${id} not found`, "NOT_FOUND");
            clients.push(c);
        }

        clients.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        const targetId = clients[0].id;
        const sourceIds = clients.slice(1).map((c) => c.id);
        const strategy: MergeStrategy = body.strategy ?? "fill_missing_from_sources";

        return clientsRepository.mergeClients({ targetId, sourceIds, strategy, salonId });
    },

    async mergeAllDuplicates(salonId: string): Promise<{
        total_groups: number;
        total_merged: number;
        total_archived: number;
        results: Array<any>;
        errors: Array<any>;
    }> {
        const groups = await clientsRepository.findAllDuplicateGroups(salonId);
        const phoneNumbers = Object.keys(groups);

        const result = {
            total_groups: phoneNumbers.length,
            total_merged: 0,
            total_archived: 0,
            results: [] as any[],
            errors: [] as any[],
        };

        if (phoneNumbers.length === 0) return result;

        for (const phone of phoneNumbers) {
            const clients = groups[phone];
            try {
                const targetId = clients[0].id;
                const sourceIds = clients.slice(1).map((c) => c.id);
                const merged = await clientsRepository.mergeClients({
                    targetId,
                    sourceIds,
                    strategy: "fill_missing_from_sources",
                    salonId,
                });
                result.total_merged += 1;
                result.total_archived += sourceIds.length;
                result.results.push({
                    phone_number: phone,
                    target_client_id: merged.target_client_id,
                    archived_client_ids: merged.archived_source_client_ids,
                    updated_fields: merged.updated_fields,
                });
            } catch (e: any) {
                result.errors.push({ phone_number: phone, message: e?.message || "Unknown error" });
            }
        }

        return result;
    },

    async search(q: string, salonId: string, limit?: number): Promise<Client[]> {
        const term = String(q || "").trim();
        if (term.length < 2) throw new AppError(400, "q must be at least 2 characters", "VALIDATION_ERROR");
        return clientsRepository.search(term, limit ?? 20, salonId);
    },
};
