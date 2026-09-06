import { Router } from "express";
import { mediaController } from "./media.controller";

const router = Router();

// Public — no auth. Matches the same audience as the local-disk /uploads
// static route: business logos, staff avatars, etc. shown on invoices,
// receipts and the public booking page.
router.get(/^\/(.+)$/, mediaController.get);

export default router;
