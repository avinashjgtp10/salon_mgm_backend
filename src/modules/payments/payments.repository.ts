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
        referral_discount_applied
      ) VALUES (
        gen_random_uuid()::text, $13,
        $1,$2,$3,$4,$5,$6,$7,
        $14,$15,
        $8,$9,$10::jsonb,$11,NOW(),$12,$16,$17,$18::jsonb,
        $19
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
        0, // $17 — reward_points_value: column kept for historical rows, but points
           // redemption no longer exists as a mechanic (see payments.service.ts)
        data.tax_breakdown ? JSON.stringify(data.tax_breakdown) : null, // $18
        data.referral_discount_applied ?? 0, // $19
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
