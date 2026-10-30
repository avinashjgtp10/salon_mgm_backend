import { Router, Request, Response, NextFunction } from "express";
import { countryPricingService } from "./country-pricing.service";

// Mounted inside super-admin.routes.ts, which is already behind authMiddleware + superAdminMiddleware.
const router = Router();

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await countryPricingService.list() });
    } catch (err) { return next(err); }
});

router.get("/:country", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await countryPricingService.get(req.params.country) });
    } catch (err) { return next(err); }
});

router.put("/:country", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await countryPricingService.set(req.params.country, req.body?.prices) });
    } catch (err) { return next(err); }
});

router.post("/:country/sync", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await countryPricingService.sync(req.params.country) });
    } catch (err) { return next(err); }
});

export default router;
