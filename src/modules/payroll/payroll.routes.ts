import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { payrollController } from "./payroll.controller";
import {
    validateListPayrollEntries,
    validateCreatePayrollEntry,
    validatePayPayrollEntry,
} from "./payroll.validator";

const router = Router();
const auth = authMiddleware;
const ownerAdmin = roleMiddleware("salon_owner", "admin");

router.get("/attendance-summary", auth, ownerAdmin, payrollController.attendanceSummary);
router.get("/salary-advances", auth, ownerAdmin, payrollController.listSalaryAdvances);
router.post("/salary-advances", auth, ownerAdmin, payrollController.createSalaryAdvance);
router.patch("/salary-advances/:advanceId", auth, ownerAdmin, payrollController.updateSalaryAdvance);
router.delete("/salary-advances/:advanceId", auth, ownerAdmin, payrollController.deleteSalaryAdvance);
router.get("/",        auth, ownerAdmin, validateListPayrollEntries, payrollController.list);
router.post("/",       auth, ownerAdmin, validateCreatePayrollEntry, payrollController.create);
router.patch("/:id",   auth, ownerAdmin, payrollController.update);
router.delete("/:id",  auth, ownerAdmin, payrollController.delete);
router.post("/:id/pay", auth, ownerAdmin, validatePayPayrollEntry, payrollController.pay);

export default router;
