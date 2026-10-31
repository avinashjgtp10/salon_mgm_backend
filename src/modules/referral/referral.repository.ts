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
  }, client?: import("pg").PoolClient): Promise<number> {
    const { clientId, salonId, type, delta, sourceType, sourceId, note } = params;
    const db = client ?? pool;

    const { rows } = await db.query(
      `UPDATE clients
       SET referral_balance = GREATEST(0, referral_balance + $1)
       WHERE id = $2
       RETURNING referral_balance`,
      [delta, clientId],
    );
    const balanceAfter = Number(rows[0]?.referral_balance) || 0;

    await db.query(
      `INSERT INTO referral_ledger
         (client_id, salon_id, type, amount, balance_after, source_type, source_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [clientId, salonId, type, delta, balanceAfter, sourceType ?? null, sourceId ?? null, note ?? null],
    );

    return balanceAfter;
  },

  // Lifetime ₹ earned through the referral program — same definition as the
  // "Referral Points" column on the Client Loyalty list (SUM of 'earn' rows).
  async getLifetimeEarned(clientId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM referral_ledger WHERE client_id = $1 AND type = 'earn'`,
      [clientId],
    );
    return Number(rows[0]?.total) || 0;
  },

  async listLedger(clientId: string, limit = 50): Promise<ReferralLedgerEntry[]> {
    const { rows } = await pool.query(
      // source_client_name: welcome/payout rows record the referred client's id
      // as source_id — joined here so the Referral table can say who the
      // record is about. NULL for every other row type.
      `SELECT l.*,
              NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '') AS source_client_name
       FROM referral_ledger l
       LEFT JOIN clients c
         ON l.source_type IN ('referral_welcome', 'referral_payout')
        AND c.id::text = l.source_id::text
       WHERE l.client_id = $1
       ORDER BY l.created_at DESC
       LIMIT $2`,
      [clientId, limit],
    );
    return rows;
  },
};
