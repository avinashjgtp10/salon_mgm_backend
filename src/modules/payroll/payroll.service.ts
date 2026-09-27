import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { staffWagesRepository } from "../staff/staffSettings.repository";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import { tipCalculationService } from "../tips/tipCalculation.service";
import { emailService } from "../utils/email.service";
import { renderPayrollReceiptPdf } from "./payroll-receipt-pdf.service";
import { renderPayrollSlipPdf } from "./payroll-slip-pdf.service";
import { buildSlipDocumentId, buildReceiptDocumentId } from "./payroll-document-id.util";
import {
    payrollEntryRepository, payrollAdjustmentRepository, payrollPaymentRepository, salaryAdvanceRepository,
} from "./payroll.repository";
import {
    AdjustPayrollBody, CommissionByCategory, PayPayrollBody, StaffPayrollSummary,
    CreateSalaryAdvanceBody, SalaryAdvanceListQuery, UpdateSalaryAdvanceBody,
} from "./payroll.types";

type SalonBranding = { business_name: string; logo_url: string | null; email: string | null; phone: string | null; address: string | null };

async function getSalonBranding(salonId: string): Promise<SalonBranding> {
    const { rows } = await pool.query(
        `SELECT business_name, logo_url, email, phone, address FROM salons WHERE id = $1`,
        [salonId]
    );
    const salon = rows[0] ?? {};
    return {
        business_name: salon.business_name ?? "Salon",
        logo_url: salon.logo_url ?? null,
        email: salon.email ?? null,
        phone: salon.phone ?? null,
        address: salon.address ?? null,
    };
}

async function getStaffNameAndDesignation(staffId: string): Promise<{ name: string; designation: string | null; email: string | null; firstName: string }> {
    const { rows } = await pool.query(`SELECT first_name, last_name, designation, email FROM staff WHERE id = $1`, [staffId]);
    const staff = rows[0];
    if (!staff) throw new AppError(404, "Staff member not found", "NOT_FOUND");
    return {
        name: [staff.first_name, staff.last_name].filter(Boolean).join(" "),
        designation: staff.designation ?? null,
        email: staff.email ?? null,
        firstName: staff.first_name,
    };
}

// commission_earned's category enum also includes gift_cards/cancellation,
// which the plan's breakdown (services/products/memberships/packages) never
// asked for — lumped into "other" here rather than silently dropped, so the
// aggregate total still reconciles against commissionCalculationService's
// own combined total. Flagged as a deviation in the implementation report.
const COMMISSION_CATEGORIES: (keyof CommissionByCategory)[] = ["services", "products", "memberships", "packages"];

async function getActiveStaffForSalon(salonId: string): Promise<{ id: string }[]> {
    const { rows } = await pool.query(
        `SELECT id FROM staff WHERE salon_id = $1 AND (is_active IS NULL OR is_active = true)`,
        [salonId]
    );
    return rows;
}

// Reuses commissionCalculationService.getEarnedBySalon per-category (one
// call per category) instead of duplicating its SQL — the existing
// aggregate function doesn't break commission out by category in one call
// (it groups by staff only), so this loops it. Cleanest reuse per the
// plan's "reusing the existing function, not duplicating SQL" instruction;
// documented as a deviation since the plan assumed a single-call breakdown.
async function getCommissionByCategoryForSalon(
    salonId: string, startDate: string, endDate: string
): Promise<Map<string, CommissionByCategory & { total: number }>> {
    const byStaff = new Map<string, CommissionByCategory & { total: number }>();
    const categoryResults = await Promise.all(
        COMMISSION_CATEGORIES.map((cat) =>
            commissionCalculationService.getEarnedBySalon(salonId, undefined, startDate, endDate, undefined, cat)
                .then((rows) => ({ cat, rows }))
        )
    );
    // "other" (gift_cards/cancellation) computed as the delta between the
    // per-category sum and the salon-wide total, so a staff member earning
    // commission in an uncovered category still shows up in the grand total
    // instead of silently vanishing.
    const totalRows = await commissionCalculationService.getEarnedBySalon(salonId, undefined, startDate, endDate);

    for (const { cat, rows } of categoryResults) {
        for (const row of rows) {
            const entry = byStaff.get(row.staff_id) ?? { services: 0, products: 0, memberships: 0, packages: 0, other: 0, total: 0 };
            entry[cat] = row.total_earned;
            byStaff.set(row.staff_id, entry);
        }
    }
    for (const row of totalRows) {
        const entry = byStaff.get(row.staff_id) ?? { services: 0, products: 0, memberships: 0, packages: 0, other: 0, total: 0 };
        const categorized = entry.services + entry.products + entry.memberships + entry.packages;
        entry.other = Math.max(0, Math.round((row.total_earned - categorized) * 100) / 100);
        entry.total = row.total_earned;
        byStaff.set(row.staff_id, entry);
    }
    return byStaff;
}

export const payrollService = {
    async getStaffSummary(salonId: string, periodStart: string, periodEnd: string): Promise<StaffPayrollSummary[]> {
        const [staffRows, commissionByStaff, tipsByStaff, entries] = await Promise.all([
            getActiveStaffForSalon(salonId),
            getCommissionByCategoryForSalon(salonId, periodStart, periodEnd),
            tipCalculationService.getEarnedBySalon(salonId, periodStart, periodEnd),
            payrollEntryRepository.listForPeriod(salonId, periodStart, periodEnd),
        ]);

        const tipsMap = new Map(tipsByStaff.map((t) => [t.staff_id, t]));
        const entryMap = new Map(entries.map((e) => [e.staff_id, e]));

        // Staff rows fetched separately for first/last name etc. — the
        // commission/tip aggregates already carry staff display fields, but
        // a staff member with zero commission/tips this period wouldn't
        // appear in either, so names come from a plain staff lookup instead.
        const { rows: staffDetails } = await pool.query(
            `SELECT id, first_name, last_name, email, calendar_color, designation FROM staff WHERE id = ANY($1::uuid[])`,
            [staffRows.map((s) => s.id)]
        );

        const summaries = await Promise.all(staffDetails.map(async (staff): Promise<StaffPayrollSummary> => {
            const wage = await staffWagesRepository.findByStaffId(staff.id);
            const commission = commissionByStaff.get(staff.id) ?? { services: 0, products: 0, memberships: 0, packages: 0, other: 0, total: 0 };
            const tips = tipsMap.get(staff.id);
            const entry = entryMap.get(staff.id);
            const advanceTotal = await salaryAdvanceRepository.totalForPeriod(salonId, staff.id, periodStart, periodEnd);

            const baseSalary = entry?.base_salary && entry.base_salary > 0 ? entry.base_salary : (wage?.salary_amount ?? 0);
            // commission/tips columns on payroll_entries hold a manual
            // adjustment override once one has been made (see
            // payroll.repository.updateField's comment) — otherwise the
            // live calculated total is authoritative, matching the plan's
            // "re-fetch live totals at pay time" requirement.
            const commissionTotal = entry && entry.commission > 0 ? entry.commission : commission.total;
            const tipsTotal = entry && entry.tips > 0 ? entry.tips : (tips?.total_tips ?? 0);
            const bonus = entry?.bonus ?? 0;
            const deductions = entry?.deductions ?? 0;
            const otherEarning = entry?.other_earning ?? 0;
            const netSalary = baseSalary + commissionTotal + tipsTotal + bonus + otherEarning - deductions - advanceTotal;

            const adjustments = entry ? await payrollAdjustmentRepository.listByEntry(entry.id) : [];

            return {
                staff_id: staff.id,
                staff_first_name: staff.first_name,
                staff_last_name: staff.last_name,
                staff_email: staff.email,
                staff_calendar_color: staff.calendar_color,
                staff_designation: staff.designation,
                base_salary: baseSalary,
                compensation_type: wage?.compensation_type ?? "none",
                commission_by_category: { services: commission.services, products: commission.products, memberships: commission.memberships, packages: commission.packages, other: commission.other },
                commission_total: commissionTotal,
                tips_total: tipsTotal,
                tips_pending: tips?.pending_payout ?? 0,
                tips_paid: tips?.paid_out ?? 0,
                bonus,
                deductions,
                other_earning: otherEarning,
                salary_advance: advanceTotal,
                net_salary: Math.round(netSalary * 100) / 100,
                status: entry?.status ?? "draft",
                payment_method: entry?.payment_method ?? null,
                payment_date: entry?.payment_date ?? null,
                payroll_entry_id: entry?.id ?? null,
                adjustments,
            };
        }));

        return summaries.sort((a, b) => a.staff_first_name.localeCompare(b.staff_first_name));
    },

    async adjustPayroll(salonId: string, staffId: string, body: AdjustPayrollBody, adjustedBy?: string | null): Promise<StaffPayrollSummary> {
        if (!body.reason || !body.reason.trim()) {
            throw new AppError(400, "A reason is required for every payroll adjustment", "VALIDATION_ERROR");
        }
        if (typeof body.adjusted_value !== "number" || !Number.isFinite(body.adjusted_value)) {
            throw new AppError(400, "adjusted_value must be a number", "VALIDATION_ERROR");
        }

        const entry = await payrollEntryRepository.ensureForPeriod(salonId, staffId, body.period_start, body.period_end);
        if (entry.status === "paid" || entry.locked_at) {
            throw new AppError(409, "This payroll period has already been paid and is locked", "PAYROLL_LOCKED");
        }

        const COLUMN_TO_FIELD_VALUE: Record<string, number> = {
            commission: entry.commission,
            bonus: entry.bonus,
            tips: entry.tips,
            deduction: entry.deductions,
            other_earning: entry.other_earning,
            salary: entry.base_salary,
        };
        const originalValue = COLUMN_TO_FIELD_VALUE[body.field];

        await payrollAdjustmentRepository.insert({
            salon_id: salonId,
            staff_id: staffId,
            payroll_entry_id: entry.id,
            field: body.field,
            original_value: originalValue,
            adjusted_value: body.adjusted_value,
            reason: body.reason.trim(),
            adjusted_by: adjustedBy ?? null,
        });

        await payrollEntryRepository.updateField(entry.id, salonId, body.field, body.adjusted_value);

        const [summary] = await this.getStaffSummary(salonId, body.period_start, body.period_end)
            .then((rows) => rows.filter((r) => r.staff_id === staffId));
        return summary;
    },

    async payStaff(salonId: string, staffId: string, body: PayPayrollBody, paidBy?: string | null): Promise<{
        summary: StaffPayrollSummary; receiptSent: boolean;
    }> {
        const [summary] = await this.getStaffSummary(salonId, body.period_start, body.period_end)
            .then((rows) => rows.filter((r) => r.staff_id === staffId));
        if (!summary) throw new AppError(404, "Staff member not found for this salon", "NOT_FOUND");
        if (summary.status === "paid") {
            throw new AppError(409, "This payroll period has already been paid", "ALREADY_PAID");
        }

        const entry = await payrollEntryRepository.ensureForPeriod(salonId, staffId, body.period_start, body.period_end);

        const client = await pool.connect();
        let paymentId: string;
        try {
            await client.query("BEGIN");

            // Duplicate-payment guard — belt-and-suspenders with the
            // UNIQUE(payroll_entry_id) constraint: this re-check inside the
            // transaction closes the race between the getStaffSummary read
            // above and this insert.
            const { rows: existingPayment } = await client.query(
                `SELECT id FROM payroll_payments WHERE payroll_entry_id = $1`,
                [entry.id]
            );
            if (existingPayment[0]) {
                throw new AppError(409, "This payroll period has already been paid", "ALREADY_PAID");
            }

            const netSalary = summary.net_salary;
            const { rows: paymentRows } = await client.query(
                `INSERT INTO payroll_payments (salon_id, staff_id, payroll_entry_id, amount, payment_method, payment_reference, paid_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 RETURNING id`,
                [salonId, staffId, entry.id, netSalary, body.payment_method, body.payment_reference ?? null, paidBy ?? null]
            );
            paymentId = paymentRows[0].id;

            await client.query(
                `UPDATE payroll_entries
                 SET status = 'paid', paid_amount = $1, payment_method = $2, payment_date = NOW(), locked_at = NOW(), updated_at = NOW()
                 WHERE id = $3 AND salon_id = $4`,
                [netSalary, body.payment_method, entry.id, salonId]
            );

            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        const [paidSummary] = await this.getStaffSummary(salonId, body.period_start, body.period_end)
            .then((rows) => rows.filter((r) => r.staff_id === staffId));

        // Fire-and-forget: never rolls back the payment already committed
        // above, matches calculateForSale/earnForSale's convention. Failure
        // just leaves receipt_sent_at null for manual resend.
        const receiptSent = await this.sendReceiptEmail(salonId, staffId, paymentId, paidSummary, body).catch((err) => {
            logger.error("payrollService: receipt email failed", { salonId, staffId, paymentId, error: err });
            return false;
        });

        return { summary: paidSummary, receiptSent };
    },

    async sendReceiptEmail(
        salonId: string, staffId: string, paymentId: string, summary: StaffPayrollSummary, period: { period_start: string; period_end: string }
    ): Promise<boolean> {
        try {
            const staff = await getStaffNameAndDesignation(staffId);
            if (!staff.email) return false;

            const payment = await payrollPaymentRepository.findByEntryId(summary.payroll_entry_id ?? "");
            if (!payment) return false;

            const salon = await getSalonBranding(salonId);
            const periodLabel = `${period.period_start} to ${period.period_end}`;
            const documentId = buildReceiptDocumentId(payment.id, period.period_start);
            const pdfBuffer = await renderPayrollReceiptPdf({
                salon, staffName: staff.name, staffDesignation: staff.designation, periodLabel, documentId, payment, netSalary: summary.net_salary,
            });
            const pdfFilename = `payment-receipt-${period.period_start}-to-${period.period_end}.pdf`;

            await emailService.sendSalaryReceiptEmail({
                to: staff.email,
                staffFirstName: staff.firstName,
                salonName: salon.business_name,
                periodLabel,
                netPay: summary.net_salary,
                pdfBuffer,
                pdfFilename,
            });

            await payrollPaymentRepository.markReceiptSent(paymentId);
            return true;
        } catch (err) {
            logger.error("payrollService.sendReceiptEmail failed", { salonId, staffId, paymentId, error: err });
            return false;
        }
    },

    // Salary Slip — the calculation breakdown, available whether or not the
    // period has been paid yet (unlike the Payment Receipt below).
    async getSalarySlipPdf(salonId: string, staffId: string, periodStart: string, periodEnd: string): Promise<{ buffer: Buffer; filename: string }> {
        const [summary] = await this.getStaffSummary(salonId, periodStart, periodEnd)
            .then((rows) => rows.filter((r) => r.staff_id === staffId));
        if (!summary) throw new AppError(404, "Staff member not found for this salon", "NOT_FOUND");

        const staff = await getStaffNameAndDesignation(staffId);
        const salon = await getSalonBranding(salonId);
        const periodLabel = `${periodStart} to ${periodEnd}`;
        // Falls back to a period-only id when no payroll_entries row exists
        // yet (no adjustment or payment has happened for this staff member
        // this period) so the slip is still downloadable in that case.
        const documentId = buildSlipDocumentId(summary.payroll_entry_id ?? `${staffId}-${periodStart}`, periodStart);

        const buffer = await renderPayrollSlipPdf({ salon, staffName: staff.name, staffDesignation: staff.designation, periodLabel, documentId, summary });
        return { buffer, filename: `salary-slip-${periodStart}-to-${periodEnd}.pdf` };
    },

    // Payment Receipt — proof of payment, only exists once payStaff has
    // created a payroll_payments row for this period.
    async getPaymentReceiptPdf(salonId: string, staffId: string, periodStart: string, periodEnd: string): Promise<{ buffer: Buffer; filename: string }> {
        const [summary] = await this.getStaffSummary(salonId, periodStart, periodEnd)
            .then((rows) => rows.filter((r) => r.staff_id === staffId));
        if (!summary) throw new AppError(404, "Staff member not found for this salon", "NOT_FOUND");
        if (summary.status !== "paid" || !summary.payroll_entry_id) {
            throw new AppError(404, "No payment recorded for this payroll period", "NOT_PAID");
        }

        const payment = await payrollPaymentRepository.findByEntryId(summary.payroll_entry_id);
        if (!payment) throw new AppError(404, "No payment recorded for this payroll period", "NOT_PAID");

        const staff = await getStaffNameAndDesignation(staffId);
        const salon = await getSalonBranding(salonId);
        const periodLabel = `${periodStart} to ${periodEnd}`;
        const documentId = buildReceiptDocumentId(payment.id, periodStart);

        const buffer = await renderPayrollReceiptPdf({
            salon, staffName: staff.name, staffDesignation: staff.designation, periodLabel, documentId, payment, netSalary: summary.net_salary,
        });
        return { buffer, filename: `payment-receipt-${periodStart}-to-${periodEnd}.pdf` };
    },

    async getHistory(salonId: string, staffId: string) {
        return payrollAdjustmentRepository.listByStaffAcrossPeriods(salonId, staffId);
    },

    // ─── Salary advances (unchanged from the pre-existing module) ─────────

    async listSalaryAdvances(salonId: string, q: SalaryAdvanceListQuery) {
        return salaryAdvanceRepository.list(salonId, q);
    },

    async createSalaryAdvance(salonId: string, data: CreateSalaryAdvanceBody) {
        return salaryAdvanceRepository.create(salonId, data);
    },

    async updateSalaryAdvance(id: string, salonId: string, data: UpdateSalaryAdvanceBody) {
        return salaryAdvanceRepository.update(id, salonId, data);
    },

    async deleteSalaryAdvance(id: string, salonId: string) {
        return salaryAdvanceRepository.delete(id, salonId);
    },
};
