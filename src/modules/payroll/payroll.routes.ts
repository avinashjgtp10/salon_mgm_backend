import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
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
// Payroll ticket's own dedicated keys only — View Payroll/Add Salary
// Advance/Pay Salary/View Payroll Details/Edit Payroll/Export Payroll,
// nothing else. manage_payroll (a pre-existing, already-enforced key not
// named by this ticket) was tried as an OR-fallback and explicitly removed
// per instruction: only expose what the ticket asks for. View Payroll
// Details and Export Payroll are frontend-only (PayrollDetailsModal/export
// use already-fetched list data, no dedicated backend route).
const addSalaryAdvance = requirePermission("add_salary_advance");
const editPayroll = requirePermission("edit_payroll");
const paySalary = requirePermission("pay_salary");
// Added on explicit request after the initial 6-key ticket shipped — Delete
// Payroll entry is now its own toggle. OR'd with edit_payroll so a staff
// member already granted the broader Edit Payroll keeps working unchanged;
// going forward an owner can also grant delete_payroll on its own.
const deletePayroll = requireAnyPermission(["delete_payroll", "edit_payroll"]);

// featureKey "payroll" (Advance tier and up) — entire module, no core-ops
// dependency from other features the way memberships/packages have.
router.use(authMiddleware, requirePlanFeature("payroll"));

router.get("/attendance-summary", auth, ownerAdminStaff, viewPayroll, payrollController.attendanceSummary);
router.get("/salary-advances", auth, ownerAdminStaff, viewPayroll, payrollController.listSalaryAdvances);
router.post("/salary-advances", auth, ownerAdminStaff, addSalaryAdvance, payrollController.createSalaryAdvance);
router.patch("/salary-advances/:advanceId", auth, ownerAdminStaff, addSalaryAdvance, payrollController.updateSalaryAdvance);
router.delete("/salary-advances/:advanceId", auth, ownerAdminStaff, addSalaryAdvance, payrollController.deleteSalaryAdvance);
router.get("/",        auth, ownerAdminStaff, viewPayroll, validateListPayrollEntries, payrollController.list);
router.post("/",       auth, ownerAdminStaff, editPayroll, validateCreatePayrollEntry, payrollController.create);
router.patch("/:id",   auth, ownerAdminStaff, editPayroll, payrollController.update);
router.delete("/:id",  auth, ownerAdminStaff, deletePayroll, payrollController.delete);
router.post("/:id/pay", auth, ownerAdminStaff, paySalary, validatePayPayrollEntry, payrollController.pay);

export default router;
