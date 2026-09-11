/**
 * Seed file: creates the initial global mobile app version configuration.
 *
 * Run once (after applying Migration/create_app_versions_table.sql):
 *   npx ts-node src/seeds/seed.app-version.ts
 *
 * Safe by design — every seeded row is force_update = false and
 * minimum_supported_version = the version currently shipped (1.0.0), so
 * running this can never force-update an installed app. Raise
 * latest_version / minimum_supported_version deliberately afterwards via
 * PUT /api/v1/app/version (super admin).
 *
 * Re-running is safe: the upsert is keyed on the (platform, environment)
 * unique constraint.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import pool from "../config/database";
import { UpsertAppVersionBody } from "../modules/app-version/app-version.types";

// The version currently declared in the mobile app's app.config.ts. Seeding the
// minimum at the shipped version means no installed build is ever below it.
const SHIPPED_VERSION = "1.0.0";

const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.salonox.app";

// The iOS app has no App Store ID yet. Leaving this null is deliberate: a
// fabricated apps.apple.com/id... link would send users to a dead page or, in
// the worst case, to somebody else's app. The mobile client already treats a
// null store URL as "no action available". Fill this in once the app is
// registered in App Store Connect.
const IOS_STORE_URL: string | null = null;

const CONFIGS: UpsertAppVersionBody[] = [
  {
    platform: "android",
    environment: "production",
    latest_version: SHIPPED_VERSION,
    minimum_supported_version: SHIPPED_VERSION,
    force_update: false,
    android_store_url: ANDROID_STORE_URL,
    ios_store_url: IOS_STORE_URL,
    title: "App Update Available!",
    message: "Update now to enjoy the latest features, improvements and bug fixes.",
    release_notes: [],
  },
  {
    platform: "ios",
    environment: "production",
    latest_version: SHIPPED_VERSION,
    minimum_supported_version: SHIPPED_VERSION,
    force_update: false,
    android_store_url: ANDROID_STORE_URL,
    ios_store_url: IOS_STORE_URL,
    title: "App Update Available!",
    message: "Update now to enjoy the latest features, improvements and bug fixes.",
    release_notes: [],
  },
];

async function seed() {
  for (const config of CONFIGS) {
    await pool.query(
      `INSERT INTO app_versions (
         platform, environment, latest_version, minimum_supported_version,
         force_update, android_store_url, ios_store_url, title, message, release_notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (platform, environment) DO NOTHING`,
      [
        config.platform,
        config.environment,
        config.latest_version,
        config.minimum_supported_version,
        config.force_update ?? false,
        config.android_store_url ?? null,
        config.ios_store_url ?? null,
        config.title ?? null,
        config.message ?? null,
        JSON.stringify(config.release_notes ?? []),
      ],
    );
    console.log(`Seeded app_versions: ${config.platform} / ${config.environment}`);
  }
}

seed()
  .then(() => {
    console.log("App version seed complete.");
    return pool.end();
  })
  .catch(async (error) => {
    console.error("App version seed failed:", error);
    await pool.end();
    process.exit(1);
  });
