import { Request, Response, NextFunction } from "express"
import { AppError } from "../../middleware/error.middleware"

const VALID_BILLING_CYCLES = ["daily", "weekly", "monthly", "yearly"]

export const validateCreatePlan = (
    req: Request, _res: Response, next: NextFunction
) => {
    try {
        const b = req.body
        if (!b.name || typeof b.name !== "string")
            throw new AppError(400, "name is required", "VALIDATION_ERROR")
        if (!b.slug || typeof b.slug !== "string")
            throw new AppError(400, "slug is required", "VALIDATION_ERROR")
        if (!b.price || typeof b.price !== "number" || b.price <= 0)
            throw new AppError(400, "price must be a positive number", "VALIDATION_ERROR")
        if (!VALID_BILLING_CYCLES.includes(b.billing_cycle))
            throw new AppError(400, `billing_cycle must be one of: ${VALID_BILLING_CYCLES.join(", ")}`, "VALIDATION_ERROR")
        return next()
    } catch (err) { return next(err) }
}

export const validateCreateSubscription = (
    req: Request, _res: Response, next: NextFunction
) => {
    try {
        const b = req.body
        if (!b.salon_id || typeof b.salon_id !== "string")
            throw new AppError(400, "salon_id is required", "VALIDATION_ERROR")
        if (!b.plan_id || typeof b.plan_id !== "string")
            throw new AppError(400, "plan_id is required", "VALIDATION_ERROR")
        return next()
    } catch (err) { return next(err) }
}

export const validateStartTrial = (
    req: Request, _res: Response, next: NextFunction
) => {
    try {
        const b = req.body
        if (!b.salon_id || typeof b.salon_id !== "string")
            throw new AppError(400, "salon_id is required", "VALIDATION_ERROR")
        if (!b.plan_id || typeof b.plan_id !== "string")
            throw new AppError(400, "plan_id is required", "VALIDATION_ERROR")
        return next()
    } catch (err) { return next(err) }
}
