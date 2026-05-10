// src/modules/clients/clients.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { clientsController } from "./clients.controller";
import { upload } from "./clients.upload";
import {
    validateCreateClient,
    validateUpdateClient,
    validateClientsListQuery,
    validateMergeClients,
    validateBlockClients,
    validateSearchClients,
} from "./clients.validator";

const router = Router();

// LIST + CREATE
router.get("/", authMiddleware, roleMiddleware("salon_owner", "admin"), validateClientsListQuery, clientsController.list);
router.post("/", authMiddleware, roleMiddleware("salon_owner", "admin"), validateCreateClient, clientsController.create);

// EXPORT (same filters)
router.get("/export", authMiddleware, roleMiddleware("salon_owner", "admin"), validateClientsListQuery, clientsController.export);

// IMPORT
router.post(
    "/import",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    upload.single("file"),
    clientsController.import
);

// GET  /api/v1/clients/duplicates?phone_number=...
router.get(
    "/duplicates",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    clientsController.findDuplicates
);

// MERGE
router.post("/merge", authMiddleware, roleMiddleware("salon_owner", "admin"), validateMergeClients, clientsController.merge);

router.post(
    "/merge-duplicates",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    clientsController.mergeAllDuplicates
);

// BLOCK
router.post("/block", authMiddleware, roleMiddleware("salon_owner", "admin"), validateBlockClients, clientsController.block);
router.patch("/block", authMiddleware, roleMiddleware("salon_owner", "admin"), validateBlockClients, clientsController.block);

// SEARCH  – must be BEFORE /:clientId to avoid "search" being parsed as a UUID
router.get("/search", authMiddleware, roleMiddleware("salon_owner", "admin"), validateSearchClients, clientsController.search);

// GET/UPDATE/DELETE by id
router.get("/:clientId", authMiddleware, roleMiddleware("salon_owner", "admin"), clientsController.getById);
router.patch("/:clientId", authMiddleware, roleMiddleware("salon_owner", "admin"), validateUpdateClient, clientsController.update);
router.delete("/:clientId", authMiddleware, roleMiddleware("salon_owner", "admin"), clientsController.remove);

export default router;
