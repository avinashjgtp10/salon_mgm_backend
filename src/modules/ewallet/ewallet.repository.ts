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
};
