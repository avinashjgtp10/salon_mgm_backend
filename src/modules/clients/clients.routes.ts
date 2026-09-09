// src/modules/clients/clients.routes.ts
import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { clientsController } from "./clients.controller";
import { upload } from "./clients.upload";
import { clientNotesController } from "../client-notes/client-notes.controller";
import { clientCommunicationController } from "../client-communication/client-communication.controller";
import { reviewsController } from "../reviews/reviews.controller";
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
// Quick Sale and Calendar both need to look up/select a client to build a
// sale or appointment, even for staff who weren't separately granted Client
// view access — same reasoning already applied to Services/Products/
// Packages/Memberships. This was the gap: everywhere else got this
// treatment, Clients didn't, which broke booking/checkout for anyone
// granted only view_calendar or create_sales.
const viewClients = requireAnyPermission(["view_clients", "create_sales", "manage_calendar"]);

// LIST + CREATE
router.get("/", authMiddleware, ownerAdminStaff, viewClients, validateClientsListQuery, clientsController.list);
router.post("/", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), validateCreateClient, clientsController.create);

// Avatar upload (stateless — must be BEFORE /:clientId)
router.post("/upload-avatar", authMiddleware, ownerAdmin, uploadMiddleware.single("avatar"), clientsController.uploadAvatar);

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
router.get("/search", authMiddleware, ownerAdminStaff, viewClients, validateSearchClients, clientsController.search);

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

// Referral-code lookup (for the "Referred by" field) — must be BEFORE /:clientId
router.get("/referral/:code", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), clientsController.lookupReferralCode);

// Client profile lookup (packages/memberships/history/loyalty in one call) via
// POST body instead of a GET query string — must be BEFORE /:clientId
router.post(
    "/:clientId/details",
    authMiddleware,
    ownerAdminStaff,
    viewClients,
    clientsController.getByIdDetails
);

// GET / PATCH / DELETE by id
router.get("/:clientId", authMiddleware, ownerAdminStaff, viewClients, clientsController.getById);
router.patch("/:clientId", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), validateUpdateClient, clientsController.update);
router.delete("/:clientId", authMiddleware, ownerAdminStaff, requirePermission("delete_clients"), clientsController.remove);

// NOTES
router.get("/:clientId/notes", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), clientNotesController.list);
router.post("/:clientId/notes", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), clientNotesController.create);
router.patch("/:clientId/notes/:id", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), clientNotesController.update);
router.delete("/:clientId/notes/:id", authMiddleware, ownerAdminStaff, requirePermission("edit_clients"), clientNotesController.delete);

// COMMUNICATIONS
router.get("/:clientId/communications", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), clientCommunicationController.list);

// FEEDBACK & REVIEW
router.get("/:clientId/reviews", authMiddleware, ownerAdminStaff, requirePermission("view_clients"), reviewsController.listForClient);

export default router;