import { appVersionRepository } from "./app-version.repository";
import {
  AppEnvironment,
  AppPlatform,
  AppVersionPublicPayload,
  AppVersionRow,
  UpsertAppVersionBody,
} from "./app-version.types";

/**
 * Numeric, segment-wise version comparison. Mirrors compareVersions() in the
 * mobile client (src/services/appUpdate.service.ts) so both sides agree:
 * string comparison would get 1.0.9 vs 1.0.10 wrong.
 *
 * Prerelease/build metadata is stripped before comparing, so 1.2.3-beta.1 and
 * 1.2.3+build.7 both compare equal to 1.2.3. Missing segments default to 0,
 * so "1.2" equals "1.2.0".
 *
 * @returns 1 when left > right, -1 when left < right, 0 when equal.
 */
export const compareVersions = (left?: string | null, right?: string | null): number => {
  const parse = (value?: string | null) =>
    (value ?? "")
      .trim()
      .split(/[+-]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const leftParts = parse(left);
  const rightParts = parse(right);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
};

// A force update is only ever meaningful in production. Dev and QA builds are
// installed as com.salonox.app.dev / .qa, which exist on no store — blocking
// one behind an "Update Now" button would trap the user with no way forward.
// The table has a CHECK constraint for this too; this clamp guarantees it even
// if a row predates that constraint or is written out of band.
const canForceUpdate = (environment: AppEnvironment) => environment === "production";

// Returned when no configuration row exists for the requested pair. Missing
// configuration must never be an update blocker: latestVersion is null, which
// the mobile client reads as "nothing to do", and forceUpdate is false.
const buildUnconfiguredPayload = (
  platform: AppPlatform,
  environment: AppEnvironment,
): AppVersionPublicPayload => ({
  platform,
  environment,
  latestVersion: null,
  minimumSupportedVersion: null,
  forceUpdate: false,
  updateAvailable: false,
  androidStoreUrl: null,
  iosStoreUrl: null,
  title: null,
  message: null,
  releaseNotes: [],
});

// Maps the snake_case row onto the camelCase contract the shipped mobile client
// already expects (same approach as reviews.service.ts for its public routes).
export const toPublicPayload = (
  row: AppVersionRow,
  currentVersion?: string | null,
): AppVersionPublicPayload => {
  const forceUpdate = Boolean(row.force_update) && canForceUpdate(row.environment);

  const payload: AppVersionPublicPayload = {
    platform: row.platform,
    environment: row.environment,
    latestVersion: row.latest_version,
    minimumSupportedVersion: row.minimum_supported_version,
    forceUpdate,
    androidStoreUrl: row.android_store_url ?? null,
    iosStoreUrl: row.ios_store_url ?? null,
    title: row.title ?? null,
    message: row.message ?? null,
    releaseNotes: Array.isArray(row.release_notes) ? row.release_notes : [],
  };

  // The mobile client owns version comparison and falls back to its own
  // compareVersions() when updateAvailable is absent. Only answer when the
  // client actually told us what it is running — never guess.
  const trimmedCurrent = currentVersion?.trim();
  if (trimmedCurrent) {
    payload.updateAvailable = compareVersions(trimmedCurrent, row.latest_version) < 0;

    // A client below the minimum supported version is force-updated even when
    // the row's force_update flag is off — but still only in production.
    if (
      !payload.forceUpdate &&
      canForceUpdate(row.environment) &&
      compareVersions(trimmedCurrent, row.minimum_supported_version) < 0
    ) {
      payload.forceUpdate = true;
    }
  }

  return payload;
};

export const appVersionService = {
  async getPublicConfig(
    platform: AppPlatform,
    environment: AppEnvironment,
    currentVersion?: string | null,
  ): Promise<AppVersionPublicPayload> {
    const row = await appVersionRepository.getByPlatformAndEnvironment(platform, environment);

    if (!row) {
      return buildUnconfiguredPayload(platform, environment);
    }

    return toPublicPayload(row, currentVersion);
  },

  async list(): Promise<AppVersionRow[]> {
    return appVersionRepository.list();
  },

  async upsert(body: UpsertAppVersionBody, updatedBy: string | null): Promise<AppVersionRow> {
    // Clamp before the write so a non-production row can never be persisted
    // with force_update = true, rather than relying on read-time correction.
    const safeBody: UpsertAppVersionBody = {
      ...body,
      force_update: canForceUpdate(body.environment) ? Boolean(body.force_update) : false,
    };

    return appVersionRepository.upsert(safeBody, updatedBy);
  },

  async remove(platform: AppPlatform, environment: AppEnvironment): Promise<AppVersionRow | null> {
    return appVersionRepository.remove(platform, environment);
  },
};
