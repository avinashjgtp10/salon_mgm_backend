import pool from "../../config/database";

export type DevicePlatform = "android" | "ios";

export interface DeviceToken {
  id: string;
  user_id: string;
  salon_id: string;
  expo_push_token: string;
  platform: DevicePlatform;
  installation_id: string | null;
  last_registered_at: string;
  last_sent_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterDeviceTokenParams {
  user_id: string;
  salon_id: string;
  expo_push_token: string;
  platform: DevicePlatform;
  installation_id?: string | null;
}

export const deviceTokensRepository = {
  async registerToken(data: RegisterDeviceTokenParams): Promise<DeviceToken> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (data.installation_id) {
        await client.query(
          `DELETE FROM device_tokens
           WHERE user_id = $1
             AND salon_id = $2
             AND platform = $3
             AND installation_id = $4
             AND expo_push_token <> $5`,
          [
            data.user_id,
            data.salon_id,
            data.platform,
            data.installation_id,
            data.expo_push_token,
          ]
        );
      }

      const { rows } = await client.query<DeviceToken>(
        `INSERT INTO device_tokens (user_id, salon_id, expo_push_token, platform, installation_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (expo_push_token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         salon_id = EXCLUDED.salon_id,
         platform = EXCLUDED.platform,
         installation_id = EXCLUDED.installation_id,
         last_registered_at = NOW(),
         last_error_code = NULL,
         last_error_message = NULL,
         failed_at = NULL,
         updated_at = NOW()
       RETURNING *`,
        [
          data.user_id,
          data.salon_id,
          data.expo_push_token,
          data.platform,
          data.installation_id ?? null,
        ]
      );

      await client.query("COMMIT");
      return rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async removeToken(expoPushToken: string): Promise<void> {
    await pool.query(
      `DELETE FROM device_tokens
       WHERE expo_push_token = $1`,
      [expoPushToken]
    );
  },

  async findBySalon(salonId: string): Promise<DeviceToken[]> {
    const { rows } = await pool.query<DeviceToken>(
      `SELECT *
       FROM device_tokens
       WHERE salon_id = $1
       ORDER BY updated_at DESC`,
      [salonId]
    );
    return rows;
  },

  async getSalonTokens(salonId: string): Promise<DeviceToken[]> {
    return this.findBySalon(salonId);
  },

  async getUserTokens(userId: string): Promise<DeviceToken[]> {
    const { rows } = await pool.query<DeviceToken>(
      `SELECT *
       FROM device_tokens
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );
    return rows;
  },

  async markTokensSent(expoPushTokens: string[]): Promise<void> {
    const tokens = Array.from(new Set(expoPushTokens.filter(Boolean)));
    if (tokens.length === 0) return;

    await pool.query(
      `UPDATE device_tokens
       SET last_sent_at = NOW(),
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = NOW()
       WHERE expo_push_token = ANY($1::text[])`,
      [tokens]
    );
  },

  async markTokenFailure(
    expoPushToken: string,
    errorCode: string,
    errorMessage?: string | null
  ): Promise<void> {
    await pool.query(
      `UPDATE device_tokens
       SET last_error_code = $2,
           last_error_message = $3,
           failed_at = NOW(),
           updated_at = NOW()
       WHERE expo_push_token = $1`,
      [expoPushToken, errorCode, errorMessage ?? null]
    );
  },
};
