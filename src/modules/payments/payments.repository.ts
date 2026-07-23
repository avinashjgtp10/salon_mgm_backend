import pool from '../../config/database';
import { Payment, CreatePaymentBody } from './payments.types';

// Bootstrap: patch the pre-existing `payments` table with the membership-wallet
// column (this table itself is created by a formal migration, not by this
// module — following the same per-module-owns-its-schema convention as
// client-memberships/cash-management/package-templates for anything added later).
export async function ensureTable(): Promise<void> {
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS membership_wallet_used NUMERIC(10,2) NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS reward_points_value NUMERIC(10,2) NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_breakdown JSONB`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS referral_discount_applied NUMERIC(10,2) NOT NULL DEFAULT 0`,
  );
  // Redemption amounts actually applied to this specific payment — distinct
  // from reward_points_value (the old, now-dead earn-time ₹ conversion) and
  // from referral_discount_applied (the referee's instant-discount, a
  // different mechanic). These back the "Reward Points Used"/"Referral
  // Credit Used" lines on a receipt.
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS reward_points_used NUMERIC(10,2) NOT NULL DEFAULT 0`,
  );
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS referral_credit_used NUMERIC(10,2) NOT NULL DEFAULT 0`,
  );
}

export const paymentsRepository = {

  async create(data: CreatePaymentBody): Promise<Payment> {
    const { rows } = await pool.query(
      `INSERT INTO payments (
        payment_id, amount,
        appointment_id, salon_id, client_id,
        gross_amount, discount_amount, ewallet_used, net_amount,
        paid_amount, due_amount,
        coupon_code, payment_method, split_details,
        status, paid_at, notes, membership_wallet_used, reward_points_value, tax_breakdown,
        referral_discount_applied, reward_points_used, referral_credit_used
      ) VALUES (
        gen_random_uuid()::text, $13,
        $1,$2,$3,$4,$5,$6,$7,
        $14,$15,
        $8,$9,$10::jsonb,$11,NOW(),$12,$16,$17,$18::jsonb,
        $19,$20,$21
      )
      RETURNING *`,
      [
        data.appointment_id ?? null,
        data.salon_id,
        data.client_id ?? null,
        data.gross_amount,
        data.discount_amount ?? 0,
        data.ewallet_used ?? 0,
        data.net_amount,
        data.coupon_code ?? null,
        data.payment_method,
        data.split_details ? JSON.stringify(data.split_details) : null,
        data.status ?? 'completed',
        data.notes ?? null,
        data.net_amount,          // $13 = amount
        data.paid_amount ?? data.net_amount,  // $14 = paid_amount (defaults to net_amount)
        data.due_amount ?? 0,     // $15 = due_amount
        data.membership_wallet_used ?? 0, // $16
        data.reward_points_value ?? 0, // $17 — ₹ value of reward points redeemed on this payment
        data.tax_breakdown ? JSON.stringify(data.tax_breakdown) : null, // $18
        data.referral_discount_applied ?? 0, // $19
        data.reward_points_used ?? 0,        // $20
        data.referral_credit_used ?? 0,      // $21
      ]
    );
    return rows[0];
  },

  async countCompletedForClient(clientId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payments WHERE client_id = $1 AND status = 'completed'`,
      [clientId]
    );
    return Number(rows[0]?.total) || 0;
  },

  async getTotalPaidForAppointment(appointmentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(paid_amount), 0)::numeric AS total
       FROM payments
       WHERE appointment_id = $1
       AND status IN ('partial', 'completed')`,
      [appointmentId]
    );
    return parseFloat(rows[0]?.total ?? '0');
  },

  // Sums benefit amounts already consumed across every prior payment on this
  // appointment (partial or completed) — used by the pricing preview endpoint
  // so re-opening a partially-paid booking doesn't imply those amounts are
  // still "fresh" balance available to apply again. Note: eWallet/reward-
  // points/referral-credit balances are already correctly net of this
  // consumption (deducted via ledger entry at payment time), so this is
  // purely informational for the preview response, not re-applied to the
  // actual clamping math.
  async getConsumedBenefitsForAppointment(appointmentId: string): Promise<{
    ewalletUsed: number;
    membershipWalletUsed: number;
    rewardPointsUsed: number;
    referralCreditUsed: number;
  }> {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(ewallet_used), 0)::numeric AS ewallet_used,
         COALESCE(SUM(membership_wallet_used), 0)::numeric AS membership_wallet_used,
         COALESCE(SUM(reward_points_used), 0)::numeric AS reward_points_used,
         COALESCE(SUM(referral_credit_used), 0)::numeric AS referral_credit_used
       FROM payments
       WHERE appointment_id = $1
       AND status IN ('partial', 'completed')`,
      [appointmentId]
    );
    const row = rows[0] ?? {};
    return {
      ewalletUsed: parseFloat(row.ewallet_used ?? '0'),
      membershipWalletUsed: parseFloat(row.membership_wallet_used ?? '0'),
      rewardPointsUsed: parseFloat(row.reward_points_used ?? '0'),
      referralCreditUsed: parseFloat(row.referral_credit_used ?? '0'),
    };
  },

  async findByAppointmentId(appointmentId: string): Promise<Payment | null> {
    const { rows } = await pool.query(
      `SELECT * FROM payments WHERE appointment_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [appointmentId]
    );
    return rows[0] || null;
  },

  async findBySalonId(salonId: string, limit = 50): Promise<Payment[]> {
    const { rows } = await pool.query(
      `SELECT * FROM payments WHERE salon_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [salonId, limit]
    );
    return rows;
  },
};
