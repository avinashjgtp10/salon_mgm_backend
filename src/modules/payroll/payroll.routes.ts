import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { payrollController } from "./payroll.controller";
import {
    validateListPayrollEntries,
    validateCreatePayrollEntry,
    validatePayPayrollEntry,
} from "./payroll.validator";

const router = Router();
const auth = authMiddleware;
// Previously owner/admin-only with no permission key at all, so
// view_payroll (already in the catalog) had no route to actually gate.
// Opened up to staff via view_payroll/manage_payroll.
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
const viewPayroll = requirePermission("view_payroll");
const managePayroll = requirePermission("manage_payroll");

router.get("/attendance-summary", auth, ownerAdminStaff, viewPayroll, payrollController.attendanceSummary);
router.get("/salary-advances", auth, ownerAdminStaff, viewPayroll, payrollController.listSalaryAdvances);
router.post("/salary-advances", auth, ownerAdminStaff, managePayroll, payrollController.createSalaryAdvance);
router.patch("/salary-advances/:advanceId", auth, ownerAdminStaff, managePayroll, payrollController.updateSalaryAdvance);
router.delete("/salary-advances/:advanceId", auth, ownerAdminStaff, managePayroll, payrollController.deleteSalaryAdvance);
router.get("/",        auth, ownerAdminStaff, viewPayroll, validateListPayrollEntries, payrollController.list);
router.post("/",       auth, ownerAdminStaff, managePayroll, validateCreatePayrollEntry, payrollController.create);
router.patch("/:id",   auth, ownerAdminStaff, managePayroll, payrollController.update);
router.delete("/:id",  auth, ownerAdminStaff, managePayroll, payrollController.delete);
router.post("/:id/pay", auth, ownerAdminStaff, managePayroll, validatePayPayrollEntry, payrollController.pay);

export default router;
