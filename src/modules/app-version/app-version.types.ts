export type AppPlatform = "android" | "ios";
export type AppEnvironment = "development" | "qa" | "production";

export const APP_PLATFORMS: AppPlatform[] = ["android", "ios"];
export const APP_ENVIRONMENTS: AppEnvironment[] = ["development", "qa", "production"];

export interface ReleaseNote {
  title: string;
  description: string;
}

// Raw row shape (snake_case), as returned by the repository.
export interface AppVersionRow {
  id: string;
  platform: AppPlatform;
  environment: AppEnvironment;
  latest_version: string;
  minimum_supported_version: string;
  force_update: boolean;
  android_store_url: string | null;
  ios_store_url: string | null;
  title: string | null;
  message: string | null;
  release_notes: ReleaseNote[];
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// Public API payload (camelCase). The key names here are fixed by the mobile
// client that is already shipped — see src/services/appUpdate.service.ts in the
// mobile repo, which reads latestVersion / minimumSupportedVersion /
// forceUpdate / updateAvailable / androidStoreUrl / iosStoreUrl / title /
// message. Do not rename these without shipping a new mobile build first.
export interface AppVersionPublicPayload {
  platform: AppPlatform;
  environment: AppEnvironment;
  // null when no configuration row exists yet — the mobile client treats a
  // missing latestVersion as "no update available" and carries on.
  latestVersion: string | null;
  minimumSupportedVersion: string | null;
  forceUpdate: boolean;
  // Omitted (undefined) when the client did not send currentVersion, so the
  // client falls back to its own comparison rather than trusting a guess.
  updateAvailable?: boolean;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
  title: string | null;
  message: string | null;
  releaseNotes: ReleaseNote[];
}

export interface UpsertAppVersionBody {
  platform: AppPlatform;
  environment: AppEnvironment;
  latest_version: string;
  minimum_supported_version: string;
  force_update?: boolean;
  android_store_url?: string | null;
  ios_store_url?: string | null;
  title?: string | null;
  message?: string | null;
  release_notes?: ReleaseNote[];
}
