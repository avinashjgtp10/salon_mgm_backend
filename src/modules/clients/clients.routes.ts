// src/modules/clients/clients.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { clientsController } from "./clients.controller";
import { upload } from "./clients.upload";
import {
    validateCreateClient,
    validateUpdateClient,
    validateClientsListQuery,
    validateMergeClients,
    validateBlockClients,
    validateUnblockClients,
    validateSearchClients,
} from "./clients.validator";

const router = Router();
const ownerAdmin = roleMiddleware("salon_owner", "admin");
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

// LIST + CREATE
router.get("/", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), validateClientsListQuery, clientsController.list);
router.post("/", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), validateCreateClient, clientsController.create);

// EXPORT (same filters)
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), validateClientsListQuery, clientsController.export);

// IMPORT
router.post("/import", authMiddleware, ownerAdmin, upload.single("file"), clientsController.import);

// GET /api/v1/clients/duplicates?phone_number=...
router.get("/duplicates", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), clientsController.findDuplicates);

// MERGE
router.post("/merge", authMiddleware, ownerAdmin, validateMergeClients, clientsController.merge);
router.post("/merge-duplicates", authMiddleware, ownerAdmin, clientsController.mergeAllDuplicates);

// BLOCK / UNBLOCK
router.post("/block", authMiddleware, ownerAdmin, validateBlockClients, clientsController.block);
router.patch("/block", authMiddleware, ownerAdmin, validateBlockClients, clientsController.block);
router.post("/unblock", authMiddleware, ownerAdmin, validateUnblockClients, clientsController.unblock);

// SEARCH — must be BEFORE /:clientId
router.get("/search", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), validateSearchClients, clientsController.search);

// Smart Filter for campaigns — must be BEFORE /:clientId
router.get("/filter", authMiddleware, ownerAdmin, clientsController.filterForCampaign);

// Clients with history stats (for Client History page filters) — must be BEFORE /:clientId
router.get(
    "/with-history-stats",
    authMiddleware,
    ownerAdminStaff,
    requirePermission("view_clients"),
    clientsController.listWithHistoryStats
);

// HISTORY for one client — must be BEFORE /:clientId
router.get(
    "/:clientId/history",
    authMiddleware,
    ownerAdminStaff,
    requirePermission("view_clients"),
    clientsController.getHistory
);

// GET / PATCH / DELETE by id
router.get("/:clientId", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), clientsController.getById);
router.patch("/:clientId", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), validateUpdateClient, clientsController.update);
router.delete("/:clientId", authMiddleware, ownerAdminStaff, requirePermission("delete_clients"), clientsController.remove);

export default router;