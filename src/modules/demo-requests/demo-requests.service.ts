import { AppError } from "../../middleware/error.middleware";
import { demoRequestsRepository } from "./demo-requests.repository";
import { CreateDemoRequestBody, DemoRequestStatus } from "./demo-requests.types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_STATUSES: DemoRequestStatus[] = ["new", "contacted", "converted", "closed", "lost", "unqualified"];

export const demoRequestsService = {
    async create(body: CreateDemoRequestBody) {
        const name = (body.name ?? "").trim();
        const email = (body.email ?? "").trim();
        if (!name) throw new AppError(400, "Name is required", "VALIDATION_ERROR");
        if (!EMAIL_RE.test(email)) throw new AppError(400, "A valid email is required", "VALIDATION_ERROR");

        return demoRequestsRepository.create({
            name,
            email,
            phone: body.phone?.trim(),
            salonName: body.salonName?.trim(),
            city: body.city?.trim(),
            locationsCount: body.locationsCount?.trim(),
        });
    },

    async list(search?: string) {
        return demoRequestsRepository.list(search);
    },

    async updateStatus(id: string, status: string) {
        if (!ALLOWED_STATUSES.includes(status as DemoRequestStatus)) {
            throw new AppError(400, `status must be one of: ${ALLOWED_STATUSES.join(", ")}`, "VALIDATION_ERROR");
        }
        const updated = await demoRequestsRepository.updateStatus(id, status as DemoRequestStatus);
        if (!updated) throw new AppError(404, "Demo request not found", "NOT_FOUND");
        return updated;
    },
};
