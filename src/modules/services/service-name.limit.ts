import { AppError } from "../../middleware/error.middleware";

/**
 * services.name is VARCHAR(255) NOT NULL (checked in the table definition of the main and the QA database; there is no CHECK constraint on it).
 * The same number is copied into other tables that hold a service name (sale_items.name, client_package_services.service_name,
 * package_template_services.service_name), all VARCHAR(255) too, so a name that fits here fits everywhere it is copied to.
 *
 * Keep the frontend's SERVICE_NAME_MAX_LENGTH (features/catalog/utils/serviceName.ts) equal to this.
 */
export const SERVICE_NAME_MAX_LENGTH = 255;

/** Postgres counts VARCHAR(n) in characters (code points), not UTF-16 units, so an emoji is 1 here although `.length` says 2. */
export const charCount = (value: string): number => Array.from(value).length;

/**
 * Throws a 400 when a service name is longer than the column can hold, instead of letting the INSERT / UPDATE fail with a database error.
 * Counts the raw value, because the raw value is what is stored (the repository does not trim it). `undefined` is ignored so an update
 * that does not touch the name passes, and existing rows (which the column already guarantees are 255 or shorter) are never affected.
 */
export function assertServiceNameLength(name: unknown): void {
    if (typeof name === "string" && charCount(name) > SERVICE_NAME_MAX_LENGTH) {
        throw new AppError(
            400,
            `Service name must be ${SERVICE_NAME_MAX_LENGTH} characters or fewer (it is ${charCount(name)}).`,
            "VALIDATION_ERROR",
        );
    }
}
