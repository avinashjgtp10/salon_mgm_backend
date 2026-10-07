// What a staff row looks like once it leaves the API.
//
// staffRepository returns the raw staff row (SELECT * / RETURNING *), and the
// invitation/password code paths read these columns from it server-side — so
// they can't be dropped at the repository. They must simply never reach a
// client: nothing in the frontend uses any of them, and password_hash /
// invitation_token in a response body are a credential leak.
const SECRET_STAFF_FIELDS = [
    "password",
    "password_hash",
    "invitation_token",
    "invitation_expires_at",
] as const;

type SecretStaffField = (typeof SECRET_STAFF_FIELDS)[number];

export function publicStaff<T extends Record<string, any>>(row: T): Omit<T, SecretStaffField> {
    if (!row || typeof row !== "object") return row;
    const out: Record<string, any> = { ...row };
    for (const field of SECRET_STAFF_FIELDS) delete out[field];
    return out as Omit<T, SecretStaffField>;
}

export function publicStaffList<T extends Record<string, any>>(rows: T[]): Omit<T, SecretStaffField>[] {
    return rows.map((r) => publicStaff(r));
}
