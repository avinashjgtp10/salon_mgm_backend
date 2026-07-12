import { Router } from "express";
import { demoRequestsController } from "./demo-requests.controller";

const router = Router();

// Public: landing page "Schedule a Free Demo" form — no auth required.
// Listing/managing these requests lives under /api/v1/super-admin/demo-requests.
router.post("/", demoRequestsController.create);

export default router;
