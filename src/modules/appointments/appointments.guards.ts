import { Request, Response, NextFunction } from "express";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { PermUser, staffHasPermission } from "../../middleware/permission.middleware";

/**
 * Editing an appointment that is already PAID needs the separate "Edit Paid Bill"
 * permission (edit_paid_bill), on top of whatever the route already requires
 * (edit_appointment / create_sales). Applies to staff only — owners and admins
 * always pass, same as every other requirePermission() check.
 *
 * Only a fully paid appointment is gated: booked/partial ones are still being
 * collected on, so editing them stays under the normal edit permission.
 *
 * Checked against the appointment's CURRENT status in the database, never
 * anything the client sends, so it can't be dodged by a crafted request body.
 * An unknown id falls through so the controller returns its usual 404.
 */
export const requirePaidBillEditPermission = async (
    req: Request & { user?: PermUser },
    _res: Response,
    next: NextFunction
) => {
    try {
        const user = req.user;
        if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
        if (user.role !== "staff") return next();

        const { rows } = await pool.query(
            `SELECT status FROM appointments WHERE id = $1`,
            [String(req.params.id)]
        );
        if (rows[0]?.status !== "paid") return next();

        if (!user.salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));
        if (await staffHasPermission(user, "edit_paid_bill")) return next();

        return next(new AppError(
            403,
            "You do not have permission to edit a paid bill (edit_paid_bill)",
            "FORBIDDEN"
        ));
    } catch (err) {
        return next(err);
    }
};
