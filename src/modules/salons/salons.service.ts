import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "./salons.repository";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";

const slugify = (text: string) =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

export const salonsService = {
    async create(ownerId: string, body: CreateSalonBody): Promise<Salon> {
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
            const created = await salonsRepository.create(ownerId, { ...body, slug: finalSlug });

            logger.info("salonsService.create success", {
                ownerId,
                salonId: created.id,
                slug: created.slug,
            });

            return created;
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
