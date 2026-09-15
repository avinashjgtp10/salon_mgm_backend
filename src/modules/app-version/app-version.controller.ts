import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { appVersionService, compareVersions } from "./app-version.service";
import {
  APP_ENVIRONMENTS,
  APP_PLATFORMS,
  AppEnvironment,
  AppPlatform,
  ReleaseNote,
  UpsertAppVersionBody,
} from "./app-version.types";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string | null };
};

// Accepts 1-3 numeric segments with optional prerelease/build metadata:
// 1, 1.0, 1.0.0, 1.0.0-beta.1, 1.0.0+build.7
const VERSION_PATTERN = /^\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)?$/;

const parsePlatform = (value: unknown): AppPlatform => {
  const platform = String(value ?? "").trim().toLowerCase();

  if (!APP_PLATFORMS.includes(platform as AppPlatform)) {
    throw new AppError(
      400,
      `platform must be one of: ${APP_PLATFORMS.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  return platform as AppPlatform;
};

const parseEnvironment = (value: unknown): AppEnvironment => {
  const environment = String(value ?? "").trim().toLowerCase();

  if (!APP_ENVIRONMENTS.includes(environment as AppEnvironment)) {
    throw new AppError(
      400,
      `environment must be one of: ${APP_ENVIRONMENTS.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  return environment as AppEnvironment;
};

const parseVersion = (value: unknown, field: string): string => {
  const version = String(value ?? "").trim();

  if (!VERSION_PATTERN.test(version)) {
    throw new AppError(400, `${field} must be a valid version (e.g. 1.0.0)`, "VALIDATION_ERROR");
  }

  return version;
};

const parseOptionalUrl = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const url = String(value).trim();

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new AppError(400, `${field} must be a valid http(s) URL`, "VALIDATION_ERROR");
  }

  return url;
};

const parseReleaseNotes = (value: unknown): ReleaseNote[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new AppError(400, "release_notes must be an array", "VALIDATION_ERROR");
  }

  return value.map((entry, index) => {
    const note = entry as { title?: unknown; description?: unknown };
    const title = String(note?.title ?? "").trim();
    const description = String(note?.description ?? "").trim();

    if (!title) {
      throw new AppError(
        400,
        `release_notes[${index}].title is required`,
        "VALIDATION_ERROR",
      );
    }

    return { title, description };
  });
};

export const appVersionController = {
  // PUBLIC — no authMiddleware. The mobile app checks for a mandatory update on
  // cold start, before login; requiring a token would stop the check firing in
  // exactly the case it exists for (a client too old to authenticate).
  async getVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const platform = parsePlatform(req.query.platform);
      const environment = parseEnvironment(req.query.environment);
      const currentVersion = req.query.currentVersion
        ? parseVersion(req.query.currentVersion, "currentVersion")
        : null;

      const data = await appVersionService.getPublicConfig(platform, environment, currentVersion);
      sendSuccess(res, 200, data, "App version configuration fetched");
    } catch (err) { next(err); }
  },

  // ── Super Admin only, below ────────────────────────────────────────────────
  async list(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await appVersionService.list();
      sendSuccess(res, 200, data, "App version configurations fetched");
    } catch (err) { next(err); }
  },

  async upsert(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = req.body as Record<string, unknown>;
      const environment = parseEnvironment(raw.environment);
      const latestVersion = parseVersion(raw.latest_version, "latest_version");
      const minimumSupportedVersion = parseVersion(
        raw.minimum_supported_version,
        "minimum_supported_version",
      );

      if (compareVersions(minimumSupportedVersion, latestVersion) > 0) {
        throw new AppError(
          400,
          "minimum_supported_version cannot be greater than latest_version",
          "VALIDATION_ERROR",
        );
      }

      const body: UpsertAppVersionBody = {
        platform: parsePlatform(raw.platform),
        environment,
        latest_version: latestVersion,
        minimum_supported_version: minimumSupportedVersion,
        force_update: Boolean(raw.force_update),
        android_store_url: parseOptionalUrl(raw.android_store_url, "android_store_url"),
        ios_store_url: parseOptionalUrl(raw.ios_store_url, "ios_store_url"),
        title: raw.title ? String(raw.title).trim() : null,
        message: raw.message ? String(raw.message).trim() : null,
        release_notes: parseReleaseNotes(raw.release_notes),
      };

      const data = await appVersionService.upsert(body, req.user?.userId ?? null);
      sendSuccess(res, 200, data, "App version configuration saved");
    } catch (err) { next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const platform = parsePlatform(req.query.platform ?? req.body?.platform);
      const environment = parseEnvironment(req.query.environment ?? req.body?.environment);

      const data = await appVersionService.remove(platform, environment);
      if (!data) throw new AppError(404, "App version configuration not found", "NOT_FOUND");

      sendSuccess(res, 200, data, "App version configuration deleted");
    } catch (err) { next(err); }
  },
};
