import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://www.salonox.com/api/v1/app/version';

// Only errors constructed here may expose their message in CI. Fetch/header
// validation and JSON parsing errors can include credential-bearing input.
class ReleaseSyncError extends Error {}

export function validateRelease(env) {
  const { VERSION_NAME: version, VERSION_CODE: code, BUILD_ID: buildId } = env;
  if (env.PLAY_RELEASE_CONFIRMED !== 'true') throw new ReleaseSyncError('Confirm actual Play availability first.');
  if (typeof version !== 'string' || version.length > 32 ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !version.split('.').every(part => Number.isSafeInteger(Number(part)))) {
    throw new ReleaseSyncError('VERSION_NAME must be a stable major.minor.patch version.');
  }
  if (!/^[1-9]\d*$/.test(code ?? '') || Number(code) > 2100000000) {
    throw new ReleaseSyncError('VERSION_CODE must be a valid Android version code.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(buildId ?? '')) {
    throw new ReleaseSyncError('BUILD_ID must identify the exact EAS build uploaded to Play.');
  }
  return { version, code, buildId };
}

export async function announceRelease(env, fetchImpl = fetch) {
  const release = validateRelease(env);
  if (!env.APP_RELEASE_TOKEN || env.APP_RELEASE_TOKEN.length < 32) {
    throw new ReleaseSyncError('Configure APP_RELEASE_TOKEN in backend repository Actions secrets.');
  }
  // These identifiers are operator-confirmed release evidence, not an EAS or
  // Play API lookup. Never treat a completed build as proof of a Play release.
  const response = await fetchImpl(API + '/release', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: 'Bearer ' + env.APP_RELEASE_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ latest_version: release.version, play_release_confirmed: true }),
  });
  if (!response.ok) throw new ReleaseSyncError('Announcement failed: HTTP ' + response.status + '.');
  const saved = await response.json();
  if (saved?.success !== true || saved?.data?.latest_version !== release.version ||
      saved?.data?.platform !== 'android' || saved?.data?.environment !== 'production') {
    throw new ReleaseSyncError('Backend did not acknowledge the expected production version.');
  }
  const query = new URLSearchParams({
    platform: 'android', environment: 'production', currentVersion: release.version,
  });
  const check = await fetchImpl(API + '?' + query, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!check.ok) throw new ReleaseSyncError('Public verification failed: HTTP ' + check.status + '; inspect before retrying.');
  const result = await check.json();
  if (result?.success !== true || result?.data?.latestVersion !== release.version ||
      result?.data?.updateAvailable !== false) {
    throw new ReleaseSyncError('Public version verification failed; inspect before retrying.');
  }
  return release;
}

export async function runAnnouncement(env, fetchImpl = fetch, logger = console) {
  const redact = message => env.APP_RELEASE_TOKEN
    ? message.replaceAll(env.APP_RELEASE_TOKEN, '[REDACTED]')
    : message;
  try {
    const { version, code, buildId } = await announceRelease(env, fetchImpl);
    logger.log(redact('Production Android version ' + version + ' verified; versionCode=' + code + '; build=' + buildId));
    return 0;
  } catch (error) {
    logger.error(redact(error instanceof ReleaseSyncError
      ? error.message
      : 'Release synchronization failed (network or response error); inspect the public version before retrying.'));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAnnouncement(process.env);
}
