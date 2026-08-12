import { Request, Response, NextFunction } from "express";
import { reviewsService } from "./reviews.service";

export const reviewsPublicController = {

    async getContext(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await reviewsService.getPublicFeedbackContext(String(req.params.slug));
            res.json({ success: true, data });
        } catch (err) {
            next(err);
        }
    },

    async submit(req: Request, res: Response, next: NextFunction) {
        try {
            const { overallRating, serviceRatings, improvementTags, additionalComments } = req.body;
            const data = await reviewsService.submitPublicFeedback(String(req.params.slug), {
                overallRating,
                serviceRatings,
                improvementTags,
                additionalComments,
            });
            res.json({ success: true, data });
        } catch (err) {
            next(err);
        }
    },
};
