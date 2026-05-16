import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

export const validateCreateSale = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    try {
        const b = req.body;
        if (!Array.isArray(b.items) || b.items.length === 0) {
            throw new AppError(400, "items array is required and cannot be empty", "VALIDATION_ERROR");
        }
        for (const item of b.items) {
            if (!["service", "product", "membership", "gift_card", "quick"].includes(item.item_type)) {
                throw new AppError(400, "Invalid item_type in items", "VALIDATION_ERROR");
            }
            if (!item.name || typeof item.quantity !== "number" || typeof item.unit_price !== "string") {
                throw new AppError(400, "Each item must have a name, quantity, and unit_price", "VALIDATION_ERROR");
            }
        }
        next();
    } catch (error) {
        next(error);
    }
};

export const validateUpdateSale = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    try {
        if (Object.keys(req.body).length === 0) {
            throw new AppError(400, "At least one field to update must be provided", "VALIDATION_ERROR");
        }
        next();
    } catch (error) {
        next(error);
    }
};

export const validateCheckoutSale = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    try {
        const { payment_method, amount_paid } = req.body;
        if (!payment_method || !["cash", "card", "gift_card", "split", "upi"].includes(payment_method)) {
            throw new AppError(400, "A valid payment_method is required (cash, card, gift_card, split, upi)", "VALIDATION_ERROR");
        }
        if (amount_paid === undefined || typeof amount_paid !== 'number') {
            throw new AppError(400, "amount_paid is required and must be a number", "VALIDATION_ERROR");
        }
        next();
    } catch (error) {
        next(error);
    }
};
