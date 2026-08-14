import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { enquiriesService } from "./enquiries.service";
import { CreateEnquiryBody, ListEnquiriesQuery, UpdateEnquiryBody } from "./enquiries.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const enquiriesController = {
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const q = req.query as any;
            const query: ListEnquiriesQuery = {
                search: q.search,
                status: q.status,
                page: q.page ? Number(q.page) : undefined,
                limit: q.limit ? Number(q.limit) : undefined,
            };
            const result = await enquiriesService.list(query, salonId);
            return sendSuccess(res, 200, result, "Enquiries fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const enquiry = await enquiriesService.getById(id, salonId);
            return sendSuccess(res, 200, enquiry, "Enquiry fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const created = await enquiriesService.create(req.body as CreateEnquiryBody, salonId);
            return sendSuccess(res, 201, created, "Enquiry created successfully");
        } catch (err) {
            return next(err);
        }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await enquiriesService.update(id, req.body as UpdateEnquiryBody, salonId);
            return sendSuccess(res, 200, updated, "Enquiry updated successfully");
        } catch (err) {
            return next(err);
        }
    },

    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            await enquiriesService.remove(id, salonId);
            return res.status(204).send();
        } catch (err) {
            return next(err);
        }
    },
};
