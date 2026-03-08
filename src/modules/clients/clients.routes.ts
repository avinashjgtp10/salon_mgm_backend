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

// MERGE
router.post("/merge", authMiddleware, roleMiddleware("salon_owner", "admin"), validateMergeClients, clientsController.merge);

// GET/UPDATE/DELETE by id
router.get("/:clientId", authMiddleware, roleMiddleware("salon_owner", "admin"), clientsController.getById);
router.patch("/:clientId", authMiddleware, roleMiddleware("salon_owner", "admin"), validateUpdateClient, clientsController.update);
router.delete("/:clientId", authMiddleware, roleMiddleware("salon_owner", "admin"), clientsController.remove);

export default router;
