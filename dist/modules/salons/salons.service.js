"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.salonsService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const salons_repository_1 = require("./salons.repository");
const auth_repository_1 = require("../auth/auth.repository");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// ── token helpers (mirrors auth.service.ts) ───────────────────────────────────
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "";
const accessOptions = { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "15m") };
const refreshOptions = { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d") };
const signAccessToken = (p) => jsonwebtoken_1.default.sign(p, ACCESS_SECRET, accessOptions);
const signRefreshToken = (p) => jsonwebtoken_1.default.sign(p, REFRESH_SECRET, refreshOptions);
const refreshExpiryDate = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
// ─────────────────────────────────────────────────────────────────────────────
const slugify = (text) => text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
exports.salonsService = {
    async create(ownerId, body) {
        logger_1.default.info("salonsService.create called", { ownerId });
        const existing = await salons_repository_1.salonsRepository.findByOwnerId(ownerId);
        if (existing) {
            throw new error_middleware_1.AppError(409, "Salon already exists for this owner", "SALON_EXISTS");
        }
        let slug = body.slug?.trim();
        if (!slug)
            slug = slugify(body.business_name);
        slug = slugify(slug);
        // ensure unique slug
        let finalSlug = slug;
        let i = 1;
        while (true) {
            const found = await salons_repository_1.salonsRepository.findBySlug(finalSlug);
            if (!found)
                break;
            i += 1;
            finalSlug = `${slug}-${i}`;
        }
        try {
            const salon = await salons_repository_1.salonsRepository.create(ownerId, { ...body, slug: finalSlug });
            // Fetch user so we can embed the correct role in the new token
            const user = await auth_repository_1.authRepository.findUserById(ownerId);
            if (!user)
                throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
            // Promote to salon_owner if they came in as a client (e.g. Google OAuth)
            if (user.role !== "salon_owner") {
                await auth_repository_1.authRepository.upgradeToSalonOwner(ownerId);
                user.role = "salon_owner";
                logger_1.default.info("salonsService.create — user promoted to salon_owner", { ownerId });
            }
            // Re-issue tokens now that salonId exists and role is correct
            const accessToken = signAccessToken({ userId: ownerId, role: user.role, salonId: salon.id });
            const refreshToken = signRefreshToken({ userId: ownerId });
            await auth_repository_1.authRepository.saveRefreshToken({
                user_id: ownerId,
                token: refreshToken,
                expires_at: refreshExpiryDate(),
            });
            // Mark onboarding complete
            await auth_repository_1.authRepository.markOnboardingComplete(ownerId);
            logger_1.default.info("salonsService.create success", {
                ownerId,
                salonId: salon.id,
                slug: salon.slug,
            });
            return {
                salon,
                accessToken,
                refreshToken,
                isOnboardingComplete: true,
            };
        }
        catch (e) {
            if (e?.code === "23505") {
                throw new error_middleware_1.AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },
    async mySalon(ownerId) {
        const salon = await salons_repository_1.salonsRepository.findByOwnerId(ownerId);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },
    async getById(id) {
        const salon = await salons_repository_1.salonsRepository.findById(id);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },
    async listAll() {
        return salons_repository_1.salonsRepository.listAll();
    },
    async updateByOwnerOrAdmin(params) {
        const { salonId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("salonsService.updateByOwnerOrAdmin called", {
            salonId,
            requesterUserId,
            requesterRole,
        });
        const salon = await salons_repository_1.salonsRepository.findById(salonId);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found", "NOT_FOUND");
        const isAdmin = requesterRole === "admin";
        const isOwner = salon.owner_id === requesterUserId;
        if (!isAdmin && !isOwner) {
            throw new error_middleware_1.AppError(403, "Forbidden", "FORBIDDEN");
        }
        if (patch.slug)
            patch.slug = slugify(patch.slug);
        try {
            const updated = await salons_repository_1.salonsRepository.update(salonId, patch);
            logger_1.default.info("salonsService.updateByOwnerOrAdmin success", {
                salonId: updated.id,
                slug: updated.slug,
            });
            return updated;
        }
        catch (e) {
            if (e?.code === "23505") {
                throw new error_middleware_1.AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },
};
//# sourceMappingURL=salons.service.js.map