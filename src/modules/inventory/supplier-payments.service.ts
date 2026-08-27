import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { suppliersRepository } from "./inventory.repository";
import { supplierPaymentsRepository } from "./supplier-payments.repository";
import {
    CreateSupplierPaymentBody,
    ListSupplierPaymentsFilters,
    PayoutMethod,
    SupplierPayment,
} from "./inventory.types";

const PAYOUT_METHODS: PayoutMethod[] = ["cash", "upi", "bank_transfer", "cheque", "card", "other"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const supplierPaymentsService = {
    async create(params: {
        supplierId: string;
        requesterUserId: string;
        salonId: string;
        body: CreateSupplierPaymentBody;
    }): Promise<SupplierPayment> {
        const { supplierId, requesterUserId, salonId, body } = params;

        const supplier = await suppliersRepository.findByIdWithBalance(supplierId, salonId);
        if (!supplier) throw new AppError(404, "Supplier not found", "NOT_FOUND");

        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
        }
        // Payouts are general balance payments (not tied to one order), so
        // the only ceiling is the supplier's current overall due amount —
        // matches payrollService.payEntry's "can't overpay the pending
        // balance" rule.
        if (amount > supplier.due_amount) {
            throw new AppError(400, "Amount cannot be greater than the outstanding balance", "VALIDATION_ERROR");
        }
        if (!ISO_DATE_RE.test(body.payment_date)) {
            throw new AppError(400, "payment_date (YYYY-MM-DD) is required", "VALIDATION_ERROR");
        }
        if (!PAYOUT_METHODS.includes(body.payment_method)) {
            throw new AppError(400, `payment_method must be one of: ${PAYOUT_METHODS.join(", ")}`, "VALIDATION_ERROR");
        }

        logger.info("supplierPaymentsService.create called", { supplierId, requesterUserId, amount });
        const created = await supplierPaymentsRepository.create(
            supplierId,
            { ...body, amount, note: body.note?.trim() || undefined },
            salonId,
            requesterUserId,
        );
        logger.info("supplierPaymentsService.create success", { paymentId: created.id, supplierId });
        return created;
    },

    async list(supplierId: string, filters: ListSupplierPaymentsFilters, salonId: string) {
        const supplier = await suppliersRepository.findById(supplierId, salonId);
        if (!supplier) throw new AppError(404, "Supplier not found", "NOT_FOUND");
        return supplierPaymentsRepository.list(supplierId, filters, salonId);
    },
};
