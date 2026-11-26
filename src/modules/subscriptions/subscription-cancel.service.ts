import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { cancelPendingReplacements, stopRecurring } from "../billing-issues/billing-issues";

export const subscriptionBillingActions = {
    // Stops automatic payments. Nothing is refunded and access is not cut: the plan runs to the end of the paid period, when
    // Razorpay's "cancelled" event closes it.
    async cancelRenewal(salonId: string) {
        const { rows } = await pool.query(
            `SELECT id, razorpay_subscription_id, current_period_end FROM subscriptions
             WHERE salon_id = $1 AND razorpay_subscription_id IS NOT NULL AND status IN ('active', 'paused')
               AND COALESCE(cancel_at_period_end, FALSE) = FALSE
             ORDER BY created_at DESC`,
            [salonId]
        );
        if (!rows.length) throw new AppError(409, "This salon has no automatic renewal to stop.", "NO_AUTO_RENEWAL");

        for (const r of rows) {
            if (!(await stopRecurring(r.razorpay_subscription_id, true, salonId))) {
                throw new AppError(424, "We couldn't stop the automatic renewal with Razorpay. It has been added to our review list; please contact support.", "RAZORPAY_ERROR");
            }
            await pool.query(`UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1`, [r.id]);
        }
        // A plan change waiting to start would otherwise begin charging after this one ends.
        await cancelPendingReplacements(salonId);
        logger.info("Automatic renewal stopped by the salon", { salonId, count: rows.length });
        return { cancelled: true, ends_at: rows[0].current_period_end ?? null };
    },
};
