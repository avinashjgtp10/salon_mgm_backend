import { Router, Request, Response, NextFunction } from "express";
import { paymentGatewayService } from "./payment-gateway.service";

// Mounted inside super-admin.routes.ts, which is already behind authMiddleware + superAdminMiddleware.
// Only /reveal returns secrets; the status says just whether each is set and its last 4 characters.
const router = Router();

type AuthedRequest = Request & { user?: { userId: string } };

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await paymentGatewayService.getStatus() });
    } catch (err) { return next(err); }
});

// The only route that returns the secrets, and only to a super admin.
router.get("/reveal", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await paymentGatewayService.reveal(req.user?.userId ?? "") });
    } catch (err) { return next(err); }
});

router.put("/",async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const changedBy = req.user?.userId;
        if (!changedBy) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        return res.json({ success: true, data: await paymentGatewayService.set(req.body ?? {}, changedBy) });
    } catch (err) { return next(err); }
});

router.post("/test", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await paymentGatewayService.test(req.body ?? {}) });
    } catch (err) { return next(err); }
});

router.delete("/", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        const changedBy = req.user?.userId;
        if (!changedBy) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });
        return res.json({ success: true, data: await paymentGatewayService.clear(changedBy) });
    } catch (err) { return next(err); }
});

export default router;
