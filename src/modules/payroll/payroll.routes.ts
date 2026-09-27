import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { payrollController } from "./payroll.controller";
import {
    validateStaffSummaryQuery, validateAdjustPayroll, validatePayPayroll, validateCreateSalaryAdvance,
} from "./payroll.validator";

const router = Router();
const auth = authMiddleware;
const payrollFeature = requirePlanFeature("payroll");

// Salary advances — view_payroll for read, add_salary_advance for create/
// update/delete (mirrors the old module's ownerAdmin-only gate, now scoped
// to the real permission keys instead).
router.get("/salary-advances", auth, payrollFeature, requirePermission("view_payroll"), payrollController.listSalaryAdvances);
router.post("/salary-advances", auth, payrollFeature, requirePermission("add_salary_advance"), validateCreateSalaryAdvance, payrollController.createSalaryAdvance);
router.patch("/salary-advances/:advanceId", auth, payrollFeature, requirePermission("add_salary_advance"), payrollController.updateSalaryAdvance);
router.delete("/salary-advances/:advanceId", auth, payrollFeature, requirePermission("add_salary_advance"), payrollController.deleteSalaryAdvance);

router.get("/staff-summary", auth, payrollFeature, requirePermission("view_payroll"), validateStaffSummaryQuery, payrollController.staffSummary);
router.post("/:staffId/adjust", auth, payrollFeature, requirePermission("edit_payroll"), validateAdjustPayroll, payrollController.adjust);
router.post("/:staffId/pay", auth, payrollFeature, requirePermission("pay_salary"), validatePayPayroll, payrollController.pay);
// Salary Slip — calculation breakdown, viewable whether or not the period is
// paid yet. Payment Receipt — proof of payment, 404s until payStaff has run
// for this period. Both gated on view_payroll_details, same as /history.
router.get("/:staffId/slip", auth, payrollFeature, requirePermission("view_payroll_details"), validateStaffSummaryQuery, payrollController.salarySlip);
router.get("/:staffId/receipt", auth, payrollFeature, requirePermission("view_payroll_details"), validateStaffSummaryQuery, payrollController.paymentReceipt);
// History reads the same adjustment audit trail edit_payroll writes to, so
// this is gated on view_payroll_details (the more specific "can see one
// staff member's breakdown" key) rather than the coarser view_payroll —
// documented judgment call, see report.
router.get("/:staffId/history", auth, payrollFeature, requirePermission("view_payroll_details"), payrollController.history);

export default router;
