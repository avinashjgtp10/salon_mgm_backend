import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import {
    CommissionRuleSource,
    CommissionRuleType,
    ConditionMetric,
    CommissionFrequency,
    CommissionScopeType,
    CommissionRuleStatus,
} from "./commissionRules.types";

const VALID_SOURCES: CommissionRuleSource[] = ["services", "products", "memberships", "packages"];
const VALID_TYPES: CommissionRuleType[] = ["percentage", "fixed", "milestone"];
const VALID_METRICS: ConditionMetric[] = ["revenue", "count"];
const VALID_FREQUENCIES: CommissionFrequency[] = ["daily", "weekly", "biweekly", "monthly", "custom"];
const VALID_SCOPE_TYPES: CommissionScopeType[] = ["salon", "staff", "role"];
const VALID_STATUSES: CommissionRuleStatus[] = ["active", "draft", "expired"];

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";
const isPositiveNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isEnum = <T extends string>(v: unknown, allowed: T[]) => typeof v === "string" && (allowed as string[]).includes(v);
const isOptionalEnum = <T extends string>(v: unknown, allowed: T[]) =>
    v === undefined || (typeof v === "string" && (allowed as string[]).includes(v));

const validateShared = (b: any, isCreate: boolean) => {
    if (isCreate || b.name !== undefined) {
        if (!isNonEmptyString(b.name))
            throw new AppError(400, "name is required and must be a non-empty string", "VALIDATION_ERROR");
    }

    if (!isOptionalEnum(b.source, VALID_SOURCES) && (isCreate || b.source !== undefined))
        throw new AppError(400, `source must be one of: ${VALID_SOURCES.join(", ")}`, "VALIDATION_ERROR");
    if (isCreate && b.source === undefined)
        throw new AppError(400, "source is required", "VALIDATION_ERROR");

    if (!isOptionalEnum(b.type, VALID_TYPES) && (isCreate || b.type !== undefined))
        throw new AppError(400, `type must be one of: ${VALID_TYPES.join(", ")}`, "VALIDATION_ERROR");
    if (isCreate && b.type === undefined)
        throw new AppError(400, "type is required", "VALIDATION_ERROR");

    const type = b.type;
    if (isCreate || b.rate !== undefined) {
        if (!isPositiveNumber(b.rate))
            throw new AppError(400, "rate is required and must be a positive number", "VALIDATION_ERROR");
        if (type === "percentage" && b.rate > 100)
            throw new AppError(400, "rate cannot exceed 100 for percentage rules", "VALIDATION_ERROR");
    }

    // Milestone rules always need a threshold condition — that's what makes it a "milestone" at all.
    if (type === "milestone") {
        if (!isPositiveNumber(b.condition_target))
            throw new AppError(400, "condition_target is required and must be a positive number for milestone rules", "VALIDATION_ERROR");
        if (!isEnum(b.condition_metric, VALID_METRICS))
            throw new AppError(400, `condition_metric is required and must be one of: ${VALID_METRICS.join(", ")}`, "VALIDATION_ERROR");
    } else {
        if (b.condition_target !== undefined && b.condition_target !== null && !isPositiveNumber(b.condition_target))
            throw new AppError(400, "condition_target must be a positive number", "VALIDATION_ERROR");
        if (!isOptionalEnum(b.condition_metric, VALID_METRICS) && b.condition_metric !== null)
            throw new AppError(400, `condition_metric must be one of: ${VALID_METRICS.join(", ")}`, "VALIDATION_ERROR");
        if ((b.condition_target !== undefined && b.condition_target !== null) && !b.condition_metric)
            throw new AppError(400, "condition_metric is required when condition_target is set", "VALIDATION_ERROR");
    }

    if (!isOptionalEnum(b.frequency, VALID_FREQUENCIES))
        throw new AppError(400, `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}`, "VALIDATION_ERROR");

    if (!isOptionalEnum(b.scope_type, VALID_SCOPE_TYPES) && (isCreate || b.scope_type !== undefined))
        throw new AppError(400, `scope_type must be one of: ${VALID_SCOPE_TYPES.join(", ")}`, "VALIDATION_ERROR");

    const scopeType = b.scope_type ?? "salon";
    if (scopeType !== "salon") {
        const hasSingle = isNonEmptyString(b.scope_id);
        const hasMultiple = Array.isArray(b.scope_ids) && b.scope_ids.length > 0 && b.scope_ids.every((id: unknown) => isNonEmptyString(id));
        if (!hasSingle && !hasMultiple)
            throw new AppError(400, "scope_id (or scope_ids for multiple staff) is required when scope_type is 'staff' or 'role'", "VALIDATION_ERROR");
    }

    if (!isOptionalEnum(b.status, VALID_STATUSES))
        throw new AppError(400, `status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR");
};

export const validateCreateCommissionRule = (req: Request, _res: Response, next: NextFunction) => {
    try {
        validateShared(req.body, true);
        return next();
    } catch (err) { return next(err); }
};

export const validateUpdateCommissionRule = (req: Request, _res: Response, next: NextFunction) => {
    try {
        validateShared(req.body, false);
        if (!isOptionalString(req.body.scope_id))
            throw new AppError(400, "scope_id must be a string", "VALIDATION_ERROR");
        return next();
    } catch (err) { return next(err); }
};

export const validateUpdateCommissionRuleStatus = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!isEnum(b.status, VALID_STATUSES))
            throw new AppError(400, `status is required and must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR");
        return next();
    } catch (err) { return next(err); }
};
