// Columns a user can pick in the Client List "Export clients" modal. The
// frontend sends the chosen keys (in the order shown) as ?columns=a,b,c;
// anything not in this whitelist is ignored so the param can never be used to
// pull a field that isn't meant to be exported (ids, avatar_url, etc.).

type Row = Record<string, any>;

const yesNo = (v: unknown) => (v ? "Yes" : "No");
const date = (v: unknown) => (v ? new Date(v as any).toISOString().slice(0, 10) : "");
const phone = (cc: unknown, num: unknown) => (num ? `${cc ?? ""} ${num}`.trim() : "");

export const CLIENT_EXPORT_COLUMNS: { key: string; label: string; get: (c: Row) => unknown }[] = [
    { key: "name", label: "Name", get: (c) => c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() },
    { key: "mobile", label: "Mobile", get: (c) => phone(c.phone_country_code, c.phone_number) },
    { key: "email", label: "Email", get: (c) => c.email ?? "" },
    { key: "additional_mobile", label: "Additional Mobile", get: (c) => phone(c.additional_phone_country_code, c.additional_phone_number) },
    { key: "additional_email", label: "Additional Email", get: (c) => c.additional_email ?? "" },
    { key: "gender", label: "Gender", get: (c) => c.gender ?? "" },
    { key: "pronouns", label: "Pronouns", get: (c) => c.pronouns ?? "" },
    { key: "birthday", label: "Birthday", get: (c) => [c.birthday_day_month, c.birthday_year].filter(Boolean).join(" ") },
    { key: "source", label: "Source", get: (c) => c.client_source ?? "" },
    { key: "preferred_language", label: "Preferred Language", get: (c) => c.preferred_language ?? "" },
    { key: "occupation", label: "Occupation", get: (c) => c.occupation ?? "" },
    { key: "country", label: "Country", get: (c) => c.country ?? "" },
    { key: "total_sales", label: "Total Sales", get: (c) => Number(c.total_sales ?? 0) },
    { key: "reviews_avg", label: "Reviews Average", get: (c) => c.reviews_avg ?? "" },
    { key: "reviews_count", label: "Reviews Count", get: (c) => c.reviews_count ?? 0 },
    { key: "status", label: "Status", get: (c) => (c.is_active === false ? "Blocked" : "Active") },
    { key: "block_reason", label: "Block Reason", get: (c) => c.block_reason ?? "" },
    { key: "email_notifications", label: "Email Notifications", get: (c) => yesNo(c.email_notifications) },
    { key: "sms_notifications", label: "SMS Notifications", get: (c) => yesNo(c.sms_notifications) },
    { key: "whatsapp_notifications", label: "WhatsApp Notifications", get: (c) => yesNo(c.whatsapp_notifications) },
    { key: "email_marketing", label: "Email Marketing", get: (c) => yesNo(c.email_marketing) },
    { key: "sms_marketing", label: "SMS Marketing", get: (c) => yesNo(c.sms_marketing) },
    { key: "whatsapp_marketing", label: "WhatsApp Marketing", get: (c) => yesNo(c.whatsapp_marketing) },
    { key: "created_at", label: "Created At", get: (c) => date(c.created_at) },
    { key: "updated_at", label: "Updated At", get: (c) => date(c.updated_at) },
];

// Parses ?columns=... into the whitelisted definitions, preserving the
// caller's order and dropping unknown/duplicate keys. Returns null when the
// param is absent (caller keeps the legacy all-fields export).
export function resolveClientExportColumns(raw: unknown) {
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    const seen = new Set<string>();
    const picked: typeof CLIENT_EXPORT_COLUMNS = [];
    for (const k of String(raw).split(",").map((s) => s.trim())) {
        const def = CLIENT_EXPORT_COLUMNS.find((d) => d.key === k);
        if (def && !seen.has(k)) { seen.add(k); picked.push(def); }
    }
    return picked;
}

export function buildClientExportRows(clients: Row[], cols: typeof CLIENT_EXPORT_COLUMNS) {
    return clients.map((c) => Object.fromEntries(cols.map((d) => [d.label, d.get(c)])));
}
