import { AppError } from "../../middleware/error.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids can come from model output as well as the client, so validate before any query.
export function requireUuid(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || !UUID_RE.test(value)) {
        throw new AppError(400, `"${String(value)}" is not a valid ${fieldName}. Use a real id returned by the services lookup.`, "INVALID_ID");
    }
    return value;
}
