import pool from "../../config/database";
import { settingsRepository } from "../settings/settings.repository";
import {
  RewardPointsConfig,
  RewardPointsLedgerEntry,
  RewardPointsLedgerType,
  DEFAULT_REWARD_POINTS_CONFIG,
} from "./reward-points.types";

const CONFIG_KEY = "REWARD_POINTS_CONFIG";

export const rewardPointsRepository = {
  async getConfig(salonId: string): Promise<RewardPointsConfig> {
    const settings = await settingsRepository.findAll(salonId);
    const row = settings.find((s) => s.key === CONFIG_KEY);
    if (!row?.value) return DEFAULT_REWARD_POINTS_CONFIG;
    try {
      const parsed = JSON.parse(row.value);
      return { ...DEFAULT_REWARD_POINTS_CONFIG, ...parsed };
    } catch {
      return DEFAULT_REWARD_POINTS_CONFIG;
    }
  },

  async getBalance(clientId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT reward_points_balance FROM clients WHERE id = $1`,
      [clientId],
    );
    return Number(rows[0]?.reward_points_balance) || 0;
  },

  // Applies a signed point delta (positive = earn, negative = redeem/adjust down),
  // records the resulting balance in a ledger row, and returns the new balance.
  async applyLedgerEntry(params: {
    clientId: string;
    salonId: string;
    type: RewardPointsLedgerType;
    delta: number;
    sourceType?: string;
    sourceId?: string;
    note?: string;
  }): Promise<number> {
    const { clientId, salonId, type, delta, sourceType, sourceId, note } = params;

    const { rows } = await pool.query(
      `UPDATE clients
       SET reward_points_balance = GREATEST(0, reward_points_balance + $1)
       WHERE id = $2
       RETURNING reward_points_balance`,
      [delta, clientId],
    );
    const balanceAfter = Number(rows[0]?.reward_points_balance) || 0;

    await pool.query(
      `INSERT INTO reward_points_ledger
         (client_id, salon_id, type, points, balance_after, source_type, source_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [clientId, salonId, type, delta, balanceAfter, sourceType ?? null, sourceId ?? null, note ?? null],
    );

    return balanceAfter;
  },

  async listLedger(clientId: string, limit = 50): Promise<RewardPointsLedgerEntry[]> {
    const { rows } = await pool.query(
      `SELECT * FROM reward_points_ledger
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, limit],
    );
    return rows;
  },
};
