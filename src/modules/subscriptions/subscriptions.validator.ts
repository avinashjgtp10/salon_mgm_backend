import { Request, Response, NextFunction } from "express"
import { AppError } from "../../middleware/error.middleware"

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
