import pool from "../../config/database";
import { settingsRepository } from "../settings/settings.repository";
import { ReferralConfig, DEFAULT_REFERRAL_CONFIG, ReferralLedgerType, ReferralLedgerEntry } from "./referral.types";

const CONFIG_KEY = "REFERRAL_CONFIG";

export const referralRepository = {
  async getConfig(salonId: string): Promise<ReferralConfig> {
    const settings = await settingsRepository.findAll(salonId);
    const row = settings.find((s) => s.key === CONFIG_KEY);
    if (!row?.value) return DEFAULT_REFERRAL_CONFIG;
    try {
      const parsed = JSON.parse(row.value);
      return { ...DEFAULT_REFERRAL_CONFIG, ...parsed };
    } catch {
      return DEFAULT_REFERRAL_CONFIG;
    }
  },

  async getBalance(clientId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT referral_balance FROM clients WHERE id = $1`,
      [clientId],
    );
    return Number(rows[0]?.referral_balance) || 0;
  },

  // Applies a signed ₹ delta (positive = earn, negative = redeem/adjust down),
  // records the resulting balance in a ledger row, and returns the new balance.
  // Mirrors rewardPointsRepository.applyLedgerEntry() field-for-field.
  async applyLedgerEntry(params: {
    clientId: string;
    salonId: string;
    type: ReferralLedgerType;
    delta: number;
    sourceType?: string;
    sourceId?: string;
    note?: string;
  }): Promise<number> {
    const { clientId, salonId, type, delta, sourceType, sourceId, note } = params;

    const { rows } = await pool.query(
      `UPDATE clients
       SET referral_balance = GREATEST(0, referral_balance + $1)
       WHERE id = $2
       RETURNING referral_balance`,
      [delta, clientId],
    );
    const balanceAfter = Number(rows[0]?.referral_balance) || 0;

    await pool.query(
      `INSERT INTO referral_ledger
         (client_id, salon_id, type, amount, balance_after, source_type, source_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [clientId, salonId, type, delta, balanceAfter, sourceType ?? null, sourceId ?? null, note ?? null],
    );

    return balanceAfter;
  },

  async listLedger(clientId: string, limit = 50): Promise<ReferralLedgerEntry[]> {
    const { rows } = await pool.query(
      `SELECT * FROM referral_ledger
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, limit],
    );
    return rows;
  },
};
