import { Request, Response, NextFunction } from "express";
import { demoRequestsService } from "./demo-requests.service";

export const demoRequestsController = {
    async create(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await demoRequestsService.create(req.body);
            return res.status(201).json({ success: true, data, message: "Demo request received" });
        } catch (err) { return next(err); }
    },
};
