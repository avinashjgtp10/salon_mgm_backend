// src/modules/clients/clients.validator.ts
import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isUUID = (v: unknown) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const isString = (v: unknown) => typeof v === "string";
const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";
const isOptionalBoolean = (v: unknown) => v === undefined || typeof v === "boolean";
const isOptionalNumber = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));

const isDateString = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isOptionalDateString = (v: unknown) => v === undefined || v === null || isDateString(v);

const isMMDD = (v: unknown) => typeof v === "string" && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const isOptionalMMDD = (v: unknown) => v === undefined || v === null || isMMDD(v);

const validateAddressesArray = (arr: any, allowId: boolean) => {
    if (arr === undefined) return;
    if (!Array.isArray(arr)) throw new AppError(400, "addresses must be array", "VALIDATION_ERROR");
    for (const a of arr) {
        if (allowId && a.id !== undefined && a.id !== null && !isUUID(a.id)) {
            throw new AppError(400, "addresses[].id must be uuid", "VALIDATION_ERROR");
        }
        if (!isString(a.type)) throw new AppError(400, "addresses[].type is required", "VALIDATION_ERROR");
        const optFields = [
            "address_name",
            "address_line1",
            "address_line2",
            "apt_suite",
            "district",
            "city",
            "region",
            "postcode",
            "country",
        ];
        for (const f of optFields) {
            if (a[f] !== undefined && a[f] !== null && typeof a[f] !== "string") {
                throw new AppError(400, `addresses[].${f} must be string`, "VALIDATION_ERROR");
            }
        }
    }
};

const validateEmergencyContactsArray = (arr: any, allowId: boolean) => {
    if (arr === undefined) return;
    if (!Array.isArray(arr)) throw new AppError(400, "emergency_contacts must be array", "VALIDATION_ERROR");
    for (const e of arr) {
        if (allowId && e.id !== undefined && e.id !== null && !isUUID(e.id)) {
            throw new AppError(400, "emergency_contacts[].id must be uuid", "VALIDATION_ERROR");
        }
        if (!isString(e.type)) throw new AppError(400, "emergency_contacts[].type is required", "VALIDATION_ERROR");
        if (!isString(e.full_name)) throw new AppError(400, "emergency_contacts[].full_name is required", "VALIDATION_ERROR");

        const optFields = ["relationship", "email", "phone_country_code", "phone_number"];
        for (const f of optFields) {
            if (e[f] !== undefined && e[f] !== null && typeof e[f] !== "string") {
                throw new AppError(400, `emergency_contacts[].${f} must be string`, "VALIDATION_ERROR");
            }
        }
    }
};

export const validateCreateClient = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isString(b.first_name) || !b.first_name.trim())
            throw new AppError(400, "first_name is required", "VALIDATION_ERROR");
        if (!isString(b.last_name) || !b.last_name.trim())
            throw new AppError(400, "last_name is required", "VALIDATION_ERROR");

        const optionalStringFields = [
            "email",
            "phone_country_code",
            "phone_number",
            "additional_email",
            "additional_phone_country_code",
            "additional_phone_number",
            "gender",
            "pronouns",
            "client_source",
            "preferred_language",
            "occupation",
            "country",
            "avatar_url",
        ] as const;

        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) throw new AppError(400, `${f} must be string`, "VALIDATION_ERROR");
        }

        if (b.referred_by_client_id !== undefined && b.referred_by_client_id !== null && !isUUID(b.referred_by_client_id)) {
            throw new AppError(400, "referred_by_client_id must be uuid", "VALIDATION_ERROR");
        }

        if (!isOptionalMMDD(b.birthday_day_month)) throw new AppError(400, "birthday_day_month must be MM-DD", "VALIDATION_ERROR");
        if (!isOptionalNumber(b.birthday_year)) throw new AppError(400, "birthday_year must be number", "VALIDATION_ERROR");

        validateAddressesArray(b.addresses, false);
        validateEmergencyContactsArray(b.emergency_contacts, false);

        return next();
    } catch (e) {
        return next(e);
    }
};

export const validateUpdateClient = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        const optionalStringFields = [
            "first_name",
            "last_name",
            "email",
            "phone_country_code",
            "phone_number",
            "additional_email",
            "additional_phone_country_code",
            "additional_phone_number",
            "gender",
            "pronouns",
            "client_source",
            "preferred_language",
            "occupation",
            "country",
            "avatar_url",
        ] as const;

        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) throw new AppError(400, `${f} must be string`, "VALIDATION_ERROR");
        }

        if (b.referred_by_client_id !== undefined && b.referred_by_client_id !== null && !isUUID(b.referred_by_client_id)) {
            throw new AppError(400, "referred_by_client_id must be uuid", "VALIDATION_ERROR");
        }

        if (!isOptionalMMDD(b.birthday_day_month)) throw new AppError(400, "birthday_day_month must be MM-DD", "VALIDATION_ERROR");
        if (!isOptionalNumber(b.birthday_year)) throw new AppError(400, "birthday_year must be number", "VALIDATION_ERROR");

        if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

        validateAddressesArray(b.addresses, true);
        validateEmergencyContactsArray(b.emergency_contacts, true);

        return next();
    } catch (e) {
        return next(e);
    }
};

export const validateClientsListQuery = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const q = req.query;

        const asInt = (v: any) => (v === undefined ? undefined : Number(String(v)));
        const offset = asInt(q.offset);
        const limit = asInt(q.limit);

        if (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
            throw new AppError(400, "offset must be integer >= 0", "VALIDATION_ERROR");
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200))
            throw new AppError(400, "limit must be integer 1..200", "VALIDATION_ERROR");

        if (q.sort_by !== undefined) {
            const sb = String(q.sort_by);
            if (!["created_at", "full_name", "total_sales"].includes(sb))
                throw new AppError(400, "sort_by invalid", "VALIDATION_ERROR");
        }

        if (q.sort_order !== undefined) {
            const so = String(q.sort_order);
            if (!["asc", "desc"].includes(so)) throw new AppError(400, "sort_order invalid", "VALIDATION_ERROR");
        }

        if (!isOptionalDateString(q.created_from)) throw new AppError(400, "created_from must be YYYY-MM-DD", "VALIDATION_ERROR");
        if (!isOptionalDateString(q.created_to)) throw new AppError(400, "created_to must be YYYY-MM-DD", "VALIDATION_ERROR");

        if (q.client_group !== undefined) {
            const cg = String(q.client_group);
            if (!["all", "fresha_accounts", "manually_added"].includes(cg)) {
                throw new AppError(400, "client_group invalid", "VALIDATION_ERROR");
            }
        }

        if (q.gender !== undefined) {
            const g = String(q.gender);
            if (!["all", "female", "male", "non_binary", "prefer_not_to_say"].includes(g)) {
                throw new AppError(400, "gender invalid", "VALIDATION_ERROR");
            }
        }

        return next();
    } catch (e) {
        return next(e);
    }
};

export const validateMergeClients = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isUUID(b.target_client_id)) throw new AppError(400, "target_client_id is required (uuid)", "VALIDATION_ERROR");
        if (!Array.isArray(b.source_client_ids) || b.source_client_ids.length < 1)
            throw new AppError(400, "source_client_ids must be non-empty uuid array", "VALIDATION_ERROR");

        for (const id of b.source_client_ids) {
            if (!isUUID(id)) throw new AppError(400, "source_client_ids must be uuid array", "VALIDATION_ERROR");
            if (id === b.target_client_id) throw new AppError(400, "source cannot equal target", "VALIDATION_ERROR");
        }

        if (b.strategy !== undefined) {
            const s = String(b.strategy);
            if (!["prefer_target", "prefer_source", "fill_missing_from_sources"].includes(s))
                throw new AppError(400, "strategy invalid", "VALIDATION_ERROR");
        }

        return next();
    } catch (e) {
        return next(e);
    }
};
