import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "../salons/salons.repository";
import { salonsService } from "../salons/salons.service";
import { servicesRepository } from "../services/services.repository";
import { staffRepository } from "../staff/staff.repository";
import { linkBuilderRepository } from "./link-builder.repository";
import { GenerateLinkBody, GenerateLinkResult, SaveLinkBody } from "./link-builder.types";

const bookingBaseUrl = () =>
    process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:5173";

export const linkBuilderService = {
    async generate(salonId: string, body: GenerateLinkBody): Promise<GenerateLinkResult> {
        const salon = await salonsRepository.findById(salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const ensured = await salonsService.ensureSlug(salon);

        const query = new URLSearchParams();

        if (body.type === "service") {
            if (!body.serviceId) throw new AppError(400, "serviceId is required", "VALIDATION_ERROR");
            const service = await servicesRepository.findById(body.serviceId, salonId);
            if (!service) throw new AppError(404, "Service not found for this salon", "NOT_FOUND");
            query.set("serviceId", body.serviceId);
        } else if (body.type === "staff") {
            if (!body.staffId) throw new AppError(400, "staffId is required", "VALIDATION_ERROR");
            const staff = await staffRepository.findById(body.staffId, salonId);
            if (!staff) throw new AppError(404, "Staff member not found for this salon", "NOT_FOUND");
            query.set("staffId", body.staffId);
        } else if (body.type !== "any") {
            throw new AppError(400, "type must be one of: any, service, staff", "VALIDATION_ERROR");
        }

        const qs = query.toString();
        const bookingUrl = `${bookingBaseUrl()}/book/${ensured.slug}${qs ? `?${qs}` : ""}`;

        return { bookingUrl, slug: ensured.slug as string };
    },

    async listSaved(salonId: string) {
        return linkBuilderRepository.list(salonId);
    },

    async saveLink(salonId: string, body: SaveLinkBody) {
        if (!body.label?.trim()) throw new AppError(400, "label is required", "VALIDATION_ERROR");
        if (!body.bookingUrl?.trim()) throw new AppError(400, "bookingUrl is required", "VALIDATION_ERROR");
        return linkBuilderRepository.create(salonId, body);
    },

    async deleteSaved(id: string, salonId: string) {
        const deleted = await linkBuilderRepository.delete(id, salonId);
        if (!deleted) throw new AppError(404, "Saved link not found", "NOT_FOUND");
    },
};
