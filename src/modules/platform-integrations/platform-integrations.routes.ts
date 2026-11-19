import { Router, Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { platformIntegrationsService } from "./platform-integrations.service";

// Mounted inside super-admin.routes.ts, which is already behind authMiddleware + superAdminMiddleware.
// Only /reveal returns secrets; status says whether each is set and its last 4 characters.
const router = Router();

type AuthedRequest = Request & { user?: { userId: string } };
const wrap = (fn: (req: AuthedRequest) => Promise<unknown>) => async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try { return res.json({ success: true, data: await fn(req) }); } catch (err) { return next(err); }
};
const uid = (req: AuthedRequest) => {
    if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    return req.user.userId;
};

router.get("/", wrap(() => platformIntegrationsService.getStatus()));
router.get("/reveal", wrap((req) => platformIntegrationsService.reveal(req.user?.userId ?? "")));
router.put("/", wrap((req) => platformIntegrationsService.set(req.body ?? {}, uid(req))));
router.post("/test/google", wrap(() => platformIntegrationsService.testGoogle()));
router.post("/test/billing", wrap(() => platformIntegrationsService.testBilling()));
router.delete("/:section", wrap((req) => platformIntegrationsService.clear(String(req.params.section), uid(req))));

export default router;
