import pool from '../../config/database';
import { PaymentTerminal, CreateTerminalBody, UpdateTerminalBody, PaymentProviderConfig, UpsertProviderConfigBody } from './payment-settings.types';

export const paymentSettingsRepository = {

  // ── Terminals ────────────────────────────────────────────────────────────
  async listTerminals(salonId: string): Promise<PaymentTerminal[]> {
    const { rows } = await pool.query(
      `SELECT * FROM payment_terminals WHERE salon_id = $1 ORDER BY created_at DESC`,
      [salonId],
    );
    return rows;
  },

  async findTerminalById(id: string, salonId: string): Promise<PaymentTerminal | null> {
    const { rows } = await pool.query(
      `SELECT * FROM payment_terminals WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return rows[0] ?? null;
  },

  async createTerminal(data: CreateTerminalBody): Promise<PaymentTerminal> {
    const { rows } = await pool.query(
      `INSERT INTO payment_terminals (salon_id, branch_id, provider, terminal_label, provider_terminal_id, serial_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.salon_id, data.branch_id ?? null, data.provider, data.terminal_label, data.provider_terminal_id ?? null, data.serial_number ?? null],
    );
    return rows[0];
  },

  async updateTerminal(id: string, salonId: string, data: UpdateTerminalBody): Promise<PaymentTerminal | null> {
    const { rows } = await pool.query(
      `UPDATE payment_terminals SET
         branch_id = COALESCE($3, branch_id),
         terminal_label = COALESCE($4, terminal_label),
         provider_terminal_id = COALESCE($5, provider_terminal_id),
         serial_number = COALESCE($6, serial_number),
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
       WHERE id = $1 AND salon_id = $2 RETURNING *`,
      [id, salonId, data.branch_id ?? null, data.terminal_label ?? null, data.provider_terminal_id ?? null, data.serial_number ?? null, data.is_active ?? null],
    );
    return rows[0] ?? null;
  },

  async deleteTerminal(id: string, salonId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM payment_terminals WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return (rowCount ?? 0) > 0;
  },

  // ── Provider configs ────────────────────────────────────────────────────
  async listProviderConfigs(salonId: string): Promise<PaymentProviderConfig[]> {
    const { rows } = await pool.query(
      `SELECT * FROM payment_provider_configs WHERE salon_id = $1 ORDER BY provider`,
      [salonId],
    );
    return rows;
  },

  async findProviderConfig(salonId: string, provider: string): Promise<PaymentProviderConfig | null> {
    const { rows } = await pool.query(
      `SELECT * FROM payment_provider_configs WHERE salon_id = $1 AND provider = $2`,
      [salonId, provider],
    );
    return rows[0] ?? null;
  },

  async upsertProviderConfig(data: UpsertProviderConfigBody): Promise<PaymentProviderConfig> {
    const { rows } = await pool.query(
      `INSERT INTO payment_provider_configs (salon_id, provider, environment, merchant_id, credentials, is_enabled)
       VALUES ($1,$2,COALESCE($3,'sandbox'),$4,$5::jsonb,COALESCE($6,false))
       ON CONFLICT (salon_id, provider) DO UPDATE SET
         environment = COALESCE($3, payment_provider_configs.environment),
         merchant_id = COALESCE($4, payment_provider_configs.merchant_id),
         credentials = COALESCE($5::jsonb, payment_provider_configs.credentials),
         is_enabled  = COALESCE($6, payment_provider_configs.is_enabled),
         updated_at  = NOW()
       RETURNING *`,
      [
        data.salon_id, data.provider, data.environment ?? null, data.merchant_id ?? null,
        data.credentials ? JSON.stringify(data.credentials) : null, data.is_enabled ?? null,
      ],
    );
    return rows[0];
  },

  async recordTestResult(salonId: string, provider: string, ok: boolean, message: string): Promise<void> {
    await pool.query(
      `UPDATE payment_provider_configs SET last_tested_at = NOW(), last_test_result = $3
       WHERE salon_id = $1 AND provider = $2`,
      [salonId, provider, `${ok ? 'OK' : 'FAILED'}: ${message}`],
    );
  },
};
