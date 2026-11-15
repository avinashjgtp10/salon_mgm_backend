import { AppError } from "../../middleware/error.middleware";
import { enquiriesRepository } from "./enquiries.repository";
import { CreateEnquiryBody, ENQUIRY_STATUSES, ListEnquiriesQuery, UpdateEnquiryBody } from "./enquiries.types";
import { getSalonCountry } from "../../config/salonTimezone";
import { isValidNationalNumber, nationalNumberError, normalizeNationalNumber } from "../../config/phoneRules";

function assertValidStatus(status: unknown) {
    if (status !== undefined && !ENQUIRY_STATUSES.includes(status as any)) {
        throw new AppError(400, `status must be one of: ${ENQUIRY_STATUSES.join(", ")}`, "VALIDATION_ERROR");
    }
}

export const enquiriesService = {
    async list(query: ListEnquiriesQuery, salonId: string) {
        return enquiriesRepository.list(query, salonId);
    },

    async getById(id: string, salonId: string) {
        const enquiry = await enquiriesRepository.findById(id, salonId);
        if (!enquiry) throw new AppError(404, "Enquiry not found", "NOT_FOUND");
        return enquiry;
    },

    async create(body: CreateEnquiryBody, salonId: string) {
        const name = (body.name ?? "").trim();
        const phone = (body.phone ?? "").trim();
        if (!name) throw new AppError(400, "Name is required", "VALIDATION_ERROR");
        // Phone length follows the salon's country (India 10 digits, UAE 9); stored as the plain national number.
        const country = await getSalonCountry(salonId);
        if (!isValidNationalNumber(phone, country)) throw new AppError(400, nationalNumberError(country), "VALIDATION_ERROR");
        assertValidStatus(body.status);

        return enquiriesRepository.create({ ...body, name, phone: normalizeNationalNumber(phone, country) }, salonId);
    },

    async update(id: string, patch: UpdateEnquiryBody, salonId: string) {
        if (patch.name !== undefined && !patch.name.trim()) {
            throw new AppError(400, "Name is required", "VALIDATION_ERROR");
        }
        if (patch.phone !== undefined) {
            const country = await getSalonCountry(salonId);
            if (!isValidNationalNumber(patch.phone, country)) throw new AppError(400, nationalNumberError(country), "VALIDATION_ERROR");
            patch = { ...patch, phone: normalizeNationalNumber(patch.phone, country) };
        }
        assertValidStatus(patch.status);

        const updated = await enquiriesRepository.update(id, patch, salonId);
        if (!updated) throw new AppError(404, "Enquiry not found", "NOT_FOUND");
        return updated;
    },

    async remove(id: string, salonId: string) {
        const deleted = await enquiriesRepository.delete(id, salonId);
        if (!deleted) throw new AppError(404, "Enquiry not found", "NOT_FOUND");
    },
};
