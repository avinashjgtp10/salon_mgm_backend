import { Request, Response, NextFunction } from "express";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { PermUser, staffHasPermission } from "../../middleware/permission.middleware";
import { ownStaffId } from "../notifications/staffNotificationScope";

type AppointmentItemRow = { id?: string; staff_id?: string | null };

async function loadAppointmentItemArrays(appointmentId: string): Promise<{
    salon_id: string;
    services: AppointmentItemRow[];
    package_items: AppointmentItemRow[];
    membership_items: AppointmentItemRow[];
} | null> {
    const { rows } = await pool.query(
        `SELECT salon_id, services, package_items, membership_items FROM appointments WHERE id = $1`,
        [appointmentId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
        salon_id: row.salon_id,
        services: row.services ?? [],
        package_items: row.package_items ?? [],
        membership_items: row.membership_items ?? [],
    };
}

/**
 * Staff handoff workflow (PATCH .../items/:itemId/status): only the staff
 * member a row is actually assigned to may start/complete it — owners/admins
 * always pass. Unlike requirePaidBillEditPermission, this is a row-level
 * OWNERSHIP check, not a permission-key check: there's no "edit someone
 * else's assigned service" override, by design (that's what handoff is for).
 */
export const requireAssignedItemStaff = async (
    req: Request & { user?: PermUser },
    _res: Response,
    next: NextFunction
) => {
    try {
        const user = req.user;
        if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
        if (user.role === "salon_owner" || user.role === "admin") return next();
        if (!user.salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

        const appointmentId = String(req.params.id ?? "");
        const itemId = String(req.params.itemId ?? "");
        const appointment = await loadAppointmentItemArrays(appointmentId);
        if (!appointment || appointment.salon_id !== user.salonId) {
            return next(new AppError(404, "Appointment not found", "NOT_FOUND"));
        }

        const item = [...appointment.services, ...appointment.package_items, ...appointment.membership_items]
            .find((row) => row.id === itemId);
        if (!item) return next(new AppError(404, "Service/package/membership row not found", "NOT_FOUND"));

        const callerStaffId = await ownStaffId(user.userId, user.salonId);
        if (callerStaffId && item.staff_id === callerStaffId) return next();

        return next(new AppError(
            403,
            "You can only start/complete a service that is assigned to you.",
            "FORBIDDEN"
        ));
    } catch (err) {
        return next(err);
    }
};

/**
 * Staff handoff workflow (POST .../items/:itemId/handoff): the handing-off
 * staff member doesn't need to own the TARGET row (it's often pre-assigned
 * to whoever they're handing off to, or unassigned) — they just need to
 * genuinely be part of this appointment (own at least one row in it).
 * Owners/admins always pass. The "your own row must already be completed"
 * rule is enforced in appointments.service.ts::handoffItem, which already
 * loads the full appointment to perform the update.
 */
export const requireParticipatingStaff = async (
    req: Request & { user?: PermUser },
    _res: Response,
    next: NextFunction
) => {
    try {
        const user = req.user;
        if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
        if (user.role === "salon_owner" || user.role === "admin") return next();
        if (!user.salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

        const appointmentId = String(req.params.id ?? "");
        const appointment = await loadAppointmentItemArrays(appointmentId);
        if (!appointment || appointment.salon_id !== user.salonId) {
            return next(new AppError(404, "Appointment not found", "NOT_FOUND"));
        }

        const callerStaffId = await ownStaffId(user.userId, user.salonId);
        const isParticipant = callerStaffId && [
            ...appointment.services, ...appointment.package_items, ...appointment.membership_items,
        ].some((row) => row.staff_id === callerStaffId);
        if (isParticipant) return next();

        return next(new AppError(
            403,
            "You can only hand off an appointment you're assigned to.",
            "FORBIDDEN"
        ));
    } catch (err) {
        return next(err);
    }
};

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
