import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);

export const validateResolveSupplierProduct = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!["link", "create_product", "ignore"].includes(b.action)) {
            throw new AppError(400, "action must be one of: link, create_product, ignore", "VALIDATION_ERROR");
        }
        if (b.action === "link" && !isUUID(b.product_id)) {
            throw new AppError(400, "product_id is required and must be a UUID when action is 'link'", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
