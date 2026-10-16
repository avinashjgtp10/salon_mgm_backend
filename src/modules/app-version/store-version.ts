import { AppPlatform } from "./app-version.types";

/**
 * Reads the version that is actually LIVE in each public store, so the mobile
 * "update available" popup appears by itself once Apple/Google approve and
 * release a build — no manual version announcement needed.
 *
 * Both sources are public pages, so nothing here needs credentials:
 * - iOS: the iTunes Lookup API (official, JSON). It only lists the version
 *   after Apple has approved AND released it.
 * - Android: the public Play Store listing. Google publishes no API for the
 *   live version, so the version is read from the listing's embedded data.
 *   Only a single, strict major.minor.patch value is accepted; anything else
 *   is treated as "unknown".
 *
 * Every failure (timeout, network, page change) resolves to null, and callers
 * then fall back to the version stored in app_versions. This can only ever
 * RAISE the advertised version to what a store is really serving.
 */

const IOS_APP_ID = "6814854823";
const BUNDLE_ID = "com.salonox.app";
// The production iOS app is published in the India storefront.
const STORE_COUNTRY = "in";

const IOS_LOOKUP_URL = `https://itunes.apple.com/lookup?id=${IOS_APP_ID}&country=${STORE_COUNTRY}`;
const PLAY_LISTING_URL = `https://play.google.com/store/apps/details?id=${BUNDLE_ID}&hl=en&gl=${STORE_COUNTRY}`;

const REQUEST_TIMEOUT_MS = 4000;
// A live version changes at most a few times a month; a short cache keeps
// /app/version fast and avoids hammering the stores on every app start.
const SUCCESS_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;

const SEMVER = /^\d+\.\d+\.\d+$/;
const PLAY_VERSION_PATTERN = /\[\[\["(\d+\.\d+\.\d+)"\]\]/g;

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

export const parseIosLookup = (body: string): string | null => {
  try {
    const data = JSON.parse(body) as { results?: { bundleId?: unknown; version?: unknown }[] };
    const app = data.results?.find((entry) => entry.bundleId === BUNDLE_ID);
    const version = typeof app?.version === "string" ? app.version.trim() : "";
    return SEMVER.test(version) ? version : null;
  } catch {
    return null;
  }
};

export const parsePlayListing = (html: string): string | null => {
  const versions = new Set(Array.from(html.matchAll(PLAY_VERSION_PATTERN), (match) => match[1]));
  // Exactly one distinct candidate, or we don't trust the page.
  return versions.size === 1 ? [...versions][0] : null;
};

const fetchText = async (fetchImpl: FetchLike, url: string): Promise<string | null> => {
  try {
    const response = await fetchImpl(url, {
      headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0 (SalonOX version check)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
};

export const createStoreVersionReader = (fetchImpl: FetchLike = fetch as unknown as FetchLike, now = () => Date.now()) => {
  const cache = new Map<AppPlatform, { version: string | null; expiresAt: number }>();
  const inFlight = new Map<AppPlatform, Promise<string | null>>();

  const load = async (platform: AppPlatform): Promise<string | null> => {
    const body = await fetchText(fetchImpl, platform === "ios" ? IOS_LOOKUP_URL : PLAY_LISTING_URL);
    if (body === null) return null;
    return platform === "ios" ? parseIosLookup(body) : parsePlayListing(body);
  };

  return async (platform: AppPlatform): Promise<string | null> => {
    const cached = cache.get(platform);
    if (cached && cached.expiresAt > now()) return cached.version;

    const pending = inFlight.get(platform);
    if (pending) return pending;

    const request = load(platform)
      .then((version) => {
        cache.set(platform, { version, expiresAt: now() + (version ? SUCCESS_TTL_MS : FAILURE_TTL_MS) });
        return version;
      })
      .finally(() => inFlight.delete(platform));
    inFlight.set(platform, request);
    return request;
  };
};

export const getLiveStoreVersion = createStoreVersionReader();
