import pool from "../../config/database";

// The people Client Announcements writes to: the owner of each salon. They are copied into the platform salon's client list
// (owner-sync.service.ts), which is what the Marketing campaign screens then pick contacts from.

export type OwnerContact = {
    salonId: string;
    salonName: string;
    ownerName: string;
    email: string | null;
    phone: string;
};

// E.164 with a "+". A bare 10-digit number is taken as Indian, like the salon campaigns do. null = not a usable number.
export function normalizePhone(phone: unknown): string | null {
    const raw = String(phone ?? "").trim();
    const digits = raw.replace(/[^0-9]/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    if (raw.startsWith("+")) return `+${digits}`;
    if (digits.length === 10) return `+91${digits}`;
    return `+${digits}`;
}

// Splits "+919876543210" into the country code and number parts the clients table stores.
export function splitPhone(e164: string): { code: string; number: string } {
    const digits = e164.replace(/[^0-9]/g, "");
    return { code: `+${digits.slice(0, digits.length - 10)}`, number: digits.slice(-10) };
}

// Owners of real (non-dummy) salons, excluding the platform salon itself. Owners without a usable number are returned
// separately so they can be reported instead of silently missing.
export async function listOwnerContacts(excludeSalonId: string): Promise<{ owners: OwnerContact[]; withoutPhone: { salonName: string; ownerName: string; reason: string }[] }> {
    const { rows } = await pool.query(
        `SELECT s.id::text AS salon_id,
                COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
                TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS owner_name,
                u.email AS email,
                u.phone AS phone
         FROM salons s
         JOIN users u ON u.id = s.owner_id
         WHERE s.is_dummy = false AND s.is_active = true AND s.id::text <> $1
         ORDER BY s.created_at`,
        [excludeSalonId]
    );

    const seen = new Set<string>();
    const owners: OwnerContact[] = [];
    const withoutPhone: { salonName: string; ownerName: string; reason: string }[] = [];
    for (const r of rows) {
        const phone = normalizePhone(r.phone);
        const ownerName = String(r.owner_name ?? "").trim();
        if (!phone) {
            withoutPhone.push({ salonName: r.salon_name, ownerName, reason: r.phone ? "Phone number is not valid" : "No phone number" });
            continue;
        }
        if (seen.has(phone.slice(-10))) continue;   // one owner running several salons is one contact
        seen.add(phone.slice(-10));
        owners.push({ salonId: r.salon_id, salonName: r.salon_name, ownerName, email: r.email ?? null, phone });
    }
    return { owners, withoutPhone };
}
