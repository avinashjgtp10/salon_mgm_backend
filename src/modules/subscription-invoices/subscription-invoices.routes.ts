import { Router, Request, Response, NextFunction } from "express";
import { subscriptionInvoicesService as svc } from "./subscription-invoices.service";

// Mounted inside super-admin.routes.ts, which is already behind authMiddleware + superAdminMiddleware.
const router = Router();
type AuthedRequest = Request & { user?: { userId: string } };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Invoices + summary cards + the "paid but not billed yet" list, in one round trip.
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const status = str(req.query.status);
        const data = await svc.overview({
            q: str(req.query.q),
            status: status === "paid" || status === "void" ? status : undefined,
            from: str(req.query.from),
            to: str(req.query.to),
            limit: Number(req.query.limit) || 50,
            offset: Number(req.query.offset) || 0,
        });
        return res.json({ success: true, data });
    } catch (err) { return next(err); }
});

router.post("/generate/:paymentId", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        return res.status(201).json({ success: true, data: await svc.generateForPayment(String(req.params.paymentId), req.user?.userId ?? null) });
    } catch (err) { return next(err); }
});

router.post("/manual", async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
        return res.status(201).json({ success: true, data: await svc.createManual(req.body ?? {}, req.user?.userId ?? null) });
    } catch (err) { return next(err); }
});

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json({ success: true, data: await svc.remove(String(req.params.id)) });
    } catch (err) { return next(err); }
});

router.get("/:id/pdf", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { pdf, filename } = await svc.renderPdf(String(req.params.id));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        return res.send(pdf);
    } catch (err) { return next(err); }
});

export default router;
