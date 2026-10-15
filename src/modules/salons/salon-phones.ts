/**
 * Every business number of a salon as one printable string: the main number first, then the additional ones
 * (Settings > Profile), de-duplicated, comma-separated - "9876543210, 9123456780". "" when there are none.
 */
export function formatSalonPhones(salon: { phone?: string | null; additional_phones?: string[] | null } | null | undefined): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of [salon?.phone, ...(salon?.additional_phones ?? [])]) {
        const p = String(raw ?? "").trim();
        const key = p.replace(/\D/g, "");
        if (!p || seen.has(key)) continue;
        seen.add(key);
        out.push(p);
    }
    return out.join(", ");
}
