import pool from "../../config/database";

export type DevicePlatform = "android" | "ios";

export interface DeviceToken {
  id: string;
  user_id: string;
  salon_id: string;
  expo_push_token: string;
  platform: DevicePlatform;
  created_at: string;
  updated_at: string;
}

export interface RegisterDeviceTokenParams {
  user_id: string;
  salon_id: string;
  expo_push_token: string;
  platform: DevicePlatform;
}

export const deviceTokensRepository = {
  async registerToken(data: RegisterDeviceTokenParams): Promise<DeviceToken> {
    const { rows } = await pool.query<DeviceToken>(
      `INSERT INTO device_tokens (user_id, salon_id, expo_push_token, platform)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (expo_push_token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         salon_id = EXCLUDED.salon_id,
         platform = EXCLUDED.platform,
         updated_at = NOW()
       RETURNING *`,
      [data.user_id, data.salon_id, data.expo_push_token, data.platform]
    );
    return rows[0];
  },

  async removeToken(expoPushToken: string): Promise<void> {
    await pool.query(
      `DELETE FROM device_tokens
       WHERE expo_push_token = $1`,
      [expoPushToken]
    );
  },

  async getSalonTokens(salonId: string): Promise<DeviceToken[]> {
    const { rows } = await pool.query<DeviceToken>(
      `SELECT *
       FROM device_tokens
       WHERE salon_id = $1
       ORDER BY updated_at DESC`,
      [salonId]
    );
    return rows;
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
};
