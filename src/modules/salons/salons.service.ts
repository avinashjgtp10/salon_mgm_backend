import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "./salons.repository";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";
import { authRepository } from "../auth/auth.repository";
import jwt, { Secret, SignOptions } from "jsonwebtoken";

// ── token helpers (mirrors auth.service.ts) ───────────────────────────────────
const ACCESS_SECRET: Secret  = process.env.JWT_ACCESS_SECRET  || "";
const REFRESH_SECRET: Secret = process.env.JWT_REFRESH_SECRET || "";

const accessOptions:  SignOptions = { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN  || "15m") as any };
const refreshOptions: SignOptions = { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d") as any };

const signAccessToken  = (p: { userId: string; role: string; salonId: string }) =>
  jwt.sign(p, ACCESS_SECRET, accessOptions);

const signRefreshToken = (p: { userId: string }) =>
  jwt.sign(p, REFRESH_SECRET, refreshOptions);

const refreshExpiryDate = () =>
  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
// ─────────────────────────────────────────────────────────────────────────────

const slugify = (text: string) =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

export const salonsService = {
    async create(ownerId: string, body: CreateSalonBody) {
        logger.info("salonsService.create called", { ownerId });

        const existing = await salonsRepository.findByOwnerId(ownerId);
        if (existing) {
            throw new AppError(409, "Salon already exists for this owner", "SALON_EXISTS");
        }

        let slug = body.slug?.trim();
        if (!slug) slug = slugify(body.business_name);
        slug = slugify(slug);

        // ensure unique slug
        let finalSlug = slug;
        let i = 1;
        while (true) {
            const found = await salonsRepository.findBySlug(finalSlug);
            if (!found) break;
            i += 1;
            finalSlug = `${slug}-${i}`;
        }

        try {
            const salon = await salonsRepository.create(ownerId, { ...body, slug: finalSlug });

            // Fetch user so we can embed the correct role in the new token
            const user = await authRepository.findUserById(ownerId);
            if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");

            // Promote to salon_owner if they came in as a client (e.g. Google OAuth)
            if (user.role !== "salon_owner") {
                await authRepository.upgradeToSalonOwner(ownerId);
                user.role = "salon_owner";
                logger.info("salonsService.create — user promoted to salon_owner", { ownerId });
            }

            // Re-issue tokens now that salonId exists and role is correct
            const accessToken  = signAccessToken({ userId: ownerId, role: user.role, salonId: salon.id });
            const refreshToken = signRefreshToken({ userId: ownerId });

            await authRepository.saveRefreshToken({
                user_id:    ownerId,
                token:      refreshToken,
                expires_at: refreshExpiryDate(),
            });

            // Mark onboarding complete
            await authRepository.markOnboardingComplete(ownerId);

            logger.info("salonsService.create success", {
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
        } catch (e: any) {
            if (e?.code === "23505") {
                throw new AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },

    async mySalon(ownerId: string): Promise<Salon> {
        const salon = await salonsRepository.findByOwnerId(ownerId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },

    async getById(id: string): Promise<Salon> {
        const salon = await salonsRepository.findById(id);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },

    async listAll(): Promise<Salon[]> {
        return salonsRepository.listAll();
    },

    async updateByOwnerOrAdmin(params: {
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateSalonBody;
    }): Promise<Salon> {
        const { salonId, requesterUserId, requesterRole, patch } = params;

        logger.info("salonsService.updateByOwnerOrAdmin called", {
            salonId,
            requesterUserId,
            requesterRole,
        });

        const salon = await salonsRepository.findById(salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const isAdmin = requesterRole === "admin";
        const isOwner = salon.owner_id === requesterUserId;

        if (!isAdmin && !isOwner) {
            throw new AppError(403, "Forbidden", "FORBIDDEN");
        }

        if (patch.slug) patch.slug = slugify(patch.slug);

        try {
            const updated = await salonsRepository.update(salonId, patch);

            logger.info("salonsService.updateByOwnerOrAdmin success", {
                salonId: updated.id,
                slug: updated.slug,
            });

            return updated;
        } catch (e: any) {
            if (e?.code === "23505") {
                throw new AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },
};
