import { Router, Request, Response, NextFunction } from "express";
import { salonSubscriptionService } from "./salon-subscription.service";

// Mounted inside super-admin.routes.ts, which is already behind
// authMiddleware + superAdminMiddleware — no auth is repeated here.
const router = Router();

router.get("/plans", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await salonSubscriptionService.listPlans() });
    } catch (err) { return next(err); }
});

router.get("/:salonId", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await salonSubscriptionService.get(String(req.params.salonId)) });
    } catch (err) { return next(err); }
});

router.put("/:salonId/expiry", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await salonSubscriptionService.adjustExpiry(String(req.params.salonId), req.body ?? {});
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

router.post("/:salonId", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await salonSubscriptionService.grant(String(req.params.salonId), req.body ?? {});
        return res.status(201).json({ success: true, data });
    } catch (err) { return next(err); }
});

export default router;
