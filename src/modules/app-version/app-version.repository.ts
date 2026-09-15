import pool from "../../config/database";
import {
  AppEnvironment,
  AppPlatform,
  AppVersionRow,
  UpsertAppVersionBody,
} from "./app-version.types";

export const appVersionRepository = {
  // The lookup is always explicit on BOTH platform and environment — a QA build
  // must never be able to fall back onto the production row.
  async getByPlatformAndEnvironment(
    platform: AppPlatform,
    environment: AppEnvironment,
  ): Promise<AppVersionRow | null> {
    const { rows } = await pool.query(
      `SELECT * FROM app_versions WHERE platform = $1 AND environment = $2 LIMIT 1`,
      [platform, environment],
    );
    return rows[0] || null;
  },

  async list(): Promise<AppVersionRow[]> {
    const { rows } = await pool.query(
      `SELECT * FROM app_versions ORDER BY environment, platform`,
    );
    return rows;
  },

  // Upsert keyed on the (platform, environment) unique constraint, so an admin
  // save can never create a duplicate configuration for the same pair.
  async upsert(body: UpsertAppVersionBody, updatedBy: string | null): Promise<AppVersionRow> {
    const { rows } = await pool.query(
      `INSERT INTO app_versions (
         platform, environment, latest_version, minimum_supported_version,
         force_update, android_store_url, ios_store_url, title, message,
         release_notes, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       ON CONFLICT (platform, environment) DO UPDATE SET
         latest_version            = EXCLUDED.latest_version,
         minimum_supported_version = EXCLUDED.minimum_supported_version,
         force_update              = EXCLUDED.force_update,
         android_store_url         = EXCLUDED.android_store_url,
         ios_store_url             = EXCLUDED.ios_store_url,
         title                     = EXCLUDED.title,
         message                   = EXCLUDED.message,
         release_notes             = EXCLUDED.release_notes,
         updated_by                = EXCLUDED.updated_by,
         updated_at                = NOW()
       RETURNING *`,
      [
        body.platform,
        body.environment,
        body.latest_version,
        body.minimum_supported_version,
        body.force_update ?? false,
        body.android_store_url ?? null,
        body.ios_store_url ?? null,
        body.title ?? null,
        body.message ?? null,
        JSON.stringify(body.release_notes ?? []),
        updatedBy,
      ],
    );
    return rows[0];
  },

  async remove(platform: AppPlatform, environment: AppEnvironment): Promise<AppVersionRow | null> {
    const { rows } = await pool.query(
      `DELETE FROM app_versions WHERE platform = $1 AND environment = $2 RETURNING *`,
      [platform, environment],
    );
    return rows[0] || null;
  },
};
