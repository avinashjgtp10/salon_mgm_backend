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

router.get("/",        auth, ownerAdmin, validateListPayrollEntries, payrollController.list);
router.post("/",       auth, ownerAdmin, validateCreatePayrollEntry, payrollController.create);
router.post("/:id/pay", auth, ownerAdmin, validatePayPayrollEntry, payrollController.pay);

export default router;
