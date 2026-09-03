import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { branchOwnerController } from "./branch-owner.controller";

const router = Router();

router.use(authMiddleware, roleMiddleware("branch_owner"));

router.get("/dashboard",         branchOwnerController.getDashboard);
router.get("/dashboard/revenue-trend", branchOwnerController.getRevenueTrend);
router.get("/payments",          branchOwnerController.getPayments);
router.post("/payments/list",    branchOwnerController.listPayments);

router.get("/salons",            branchOwnerController.getMySalons);
router.post("/salons/list",      branchOwnerController.listMySalons);
router.post("/salons/:id/enter", branchOwnerController.enterSalon);
router.post("/salons/:id/reset-password", branchOwnerController.resetSalonOwnerPassword);
router.delete("/salons/:id",     branchOwnerController.deleteSalon);

router.get("/salons/:salonId/staff", branchOwnerController.getSalonStaff);
router.post("/staff/list",           branchOwnerController.listAllStaff);
router.patch("/salons/:salonId/staff/:staffId/permissions", branchOwnerController.updateSalonStaffPermissions);

router.get("/salons/:salonId/subscription", branchOwnerController.getSalonSubscription);
router.get("/salons/:salonId/invoices",     branchOwnerController.getSalonInvoices);

router.get("/salons/:salonId/products", branchOwnerController.listSalonProducts);
router.get("/stock-transfer/suggest-match", branchOwnerController.suggestMatch);
router.post("/stock-transfer", branchOwnerController.transferStock);
router.post("/stock-transfer/:id/complete", branchOwnerController.completeTransfer);
router.post("/stock-transfer/:id/cancel", branchOwnerController.cancelTransfer);
router.get("/stock-transfers", branchOwnerController.listTransfers);

router.get("/inventory/summary", branchOwnerController.getInventorySummary);
router.get("/inventory/branch-overview", branchOwnerController.getBranchOverview);
router.get("/inventory/low-stock", branchOwnerController.getLowStockAlerts);
router.get("/inventory/categories", branchOwnerController.getCategoryBreakdown);
router.get("/inventory/categories/:categoryName/products", branchOwnerController.getProductsByCategory);

router.get("/finance/overview", branchOwnerController.getFinanceOverview);
router.get("/finance/cash-management", branchOwnerController.getCashManagementOverview);
router.get("/finance/salons/:salonId/commissions", branchOwnerController.getSalonStaffCommissions);
router.post("/finance/salons/:salonId/commissions/settle", branchOwnerController.settleStaffCommission);

router.get("/staff-performance", branchOwnerController.getStaffPerformance);
router.post("/staff-performance/list", branchOwnerController.listStaffPerformance);

router.post("/support", branchOwnerController.submitSupportTicket);

router.get("/notifications",              branchOwnerController.listNotifications);
router.get("/notifications/unread-count", branchOwnerController.unreadNotificationCount);
router.patch("/notifications/read-all",   branchOwnerController.markAllNotificationsRead);
router.patch("/notifications/:id/read",   branchOwnerController.markNotificationRead);

export default router;
