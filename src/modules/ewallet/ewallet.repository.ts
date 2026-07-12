import pool from "../../config/database";
import { EwalletLedgerEntry, EwalletLedgerType } from "./ewallet.types";

export const ewalletRepository = {
  async getBalance(clientId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT ewallet_balance FROM clients WHERE id = $1`,
      [clientId],
    );
    return Number(rows[0]?.ewallet_balance) || 0;
  },

  // Applies a signed ₹ delta (positive = topup/adjust up, negative = redeem/adjust down),
  // records the resulting balance in a ledger row, and returns the new balance.
  // Never lets the balance go negative — a redeem larger than the balance is capped
  // by the caller before this is invoked (same pattern as reward-points redemption).
  async applyLedgerEntry(params: {
    clientId: string;
    salonId: string;
    type: EwalletLedgerType;
    delta: number;
    sourceType?: string;
    sourceId?: string;
    note?: string;
    createdBy?: string;
  }): Promise<number> {
    const { clientId, salonId, type, delta, sourceType, sourceId, note, createdBy } = params;

    const { rows } = await pool.query(
      `UPDATE clients
       SET ewallet_balance = GREATEST(0, ewallet_balance + $1)
       WHERE id = $2
       RETURNING ewallet_balance`,
      [delta, clientId],
    );
    const balanceAfter = Number(rows[0]?.ewallet_balance) || 0;

    await pool.query(
      `INSERT INTO ewallet_ledger
         (client_id, salon_id, type, amount, balance_after, source_type, source_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [clientId, salonId, type, delta, balanceAfter, sourceType ?? null, sourceId ?? null, note ?? null, createdBy ?? null],
    );

    return balanceAfter;
  },

  async listLedger(clientId: string, limit = 50): Promise<EwalletLedgerEntry[]> {
    const { rows } = await pool.query(
      `SELECT * FROM ewallet_ledger
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, limit],
    );
    return rows;
  },

  async getLedgerAggregate(clientId: string): Promise<{ referral_rewards: number; reward_credits: number; other_credits: number; wallet_debits: number }> {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'topup' AND source_type = 'referral'), 0) AS referral_rewards,
         COALESCE(SUM(amount) FILTER (WHERE type = 'topup' AND source_type IN ('reward', 'reward_migration')), 0) AS reward_credits,
         COALESCE(SUM(amount) FILTER (WHERE type = 'topup' AND (source_type IS NULL OR source_type NOT IN ('referral', 'reward', 'reward_migration'))), 0) AS other_credits,
         COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0) AS wallet_debits
       FROM ewallet_ledger
       WHERE client_id = $1`,
      [clientId],
    );
    return {
      referral_rewards: parseFloat(rows[0]?.referral_rewards ?? '0'),
      reward_credits: parseFloat(rows[0]?.reward_credits ?? '0'),
      other_credits: parseFloat(rows[0]?.other_credits ?? '0'),
      wallet_debits: parseFloat(rows[0]?.wallet_debits ?? '0'),
    };
  },
};
