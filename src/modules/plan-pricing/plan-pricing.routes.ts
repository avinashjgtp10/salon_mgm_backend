import { Router, Request, Response, NextFunction } from "express";
import { planPricingService } from "./plan-pricing.service";

// Mounted inside super-admin.routes.ts, which is already behind
// authMiddleware + superAdminMiddleware — no auth is repeated here.
const router = Router();

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await planPricingService.list() });
    } catch (err) { return next(err); }
});

router.put("/:slug", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await planPricingService.set(req.params.slug, req.body?.prices);
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

export default router;
