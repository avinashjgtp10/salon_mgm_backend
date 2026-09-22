import { AppError } from "../../middleware/error.middleware";
import { cashManagementRepository } from "./cash-management.repository";
import { salonDashboardService } from "../salon-dashboard/salon-dashboard.service";
import { salonsRepository } from "../salons/salons.repository";
import { usersRepo } from "../users/users.repository";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import logger from "../../config/logger";
import type {
  CloseCounterBody,
  CounterListFilters,
  CreateExpenseBody,
  ExpenseListFilters,
  OpenCounterBody,
  SummaryBundleBody,
  SummaryBundleSection,
  UpdateExpenseBody,
} from "./cash-management.types";

const SUMMARY_BUNDLE_SECTIONS: SummaryBundleSection[] = [
  "cash_dashboard",
  "cash_counters",
  "cash_expenses",
  "dashboard_summary",
];

const formatDateIST = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

const formatTimeIST = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });

const formatMoney = (n: number) => `₹${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

// The owner's own "WhatsApp Alerts Number" (users.phone, Settings > Profile
// & Business > Contact Details) is the first choice — it's specifically
// meant for internal alerts like this one, kept separate from Business Phone
// (salons.phone) so a customer-facing print number never silently becomes
// where these operational messages get sent. Falls back to Business Phone
// for any salon that hasn't set a personal alerts number, so this doesn't
// silently stop working for existing salons.
async function resolveOwnerNotifyPhone(salon: any): Promise<string | null> {
  if (salon?.owner_id) {
    const owner = await usersRepo.findById(salon.owner_id);
    if (owner?.phone) return owner.phone;
  }
  return salon?.phone || null;
}

// Fire-and-forget WhatsApp alert to the SALON OWNER (never a client) after a
// counter open/close — deliberately not awaited by either caller below, and
// whatsappAutomationService.trigger() itself never throws, so a WhatsApp
// failure (missing config, unapproved template, Meta rejection, timeout)
// can never block or fail the open/close transaction that already committed.
// referenceId is the counter's own row id — combined with dedupeByReference,
// this can send at most once per (event, counter), even on a retry.
async function notifyOwnerCashCounterOpened(salonId: string, counter: any): Promise<void> {
  try {
    const salon = await salonsRepository.findById(salonId);
    const ownerPhone = await resolveOwnerNotifyPhone(salon);
    if (!ownerPhone) {
      logger.info(`[WA-AUTO] cash_counter_opened skipped — salon ${salonId} has no owner WhatsApp number on file`);
      return;
    }
    const variables = {
      "1": salon?.business_name ?? "your salon",
      "2": formatDateIST(counter.opened_at),
      "3": formatTimeIST(counter.opened_at),
      "4": formatMoney(parseFloat(counter.opening_balance ?? "0")),
    };
    await whatsappAutomationService.trigger({
      salonId,
      eventType: "cash_counter_opened",
      clientId: null,
      phone: ownerPhone,
      countryCode: null,
      variables,
      referenceId: counter.id,
      referenceType: "cash_management",
      dedupeByReference: true,
    });
  } catch (err: any) {
    logger.error("[WA-AUTO] cash_counter_opened trigger failed:", err?.message ?? err);
  }
}

async function notifyOwnerCashCounterClosed(salonId: string, counter: any): Promise<void> {
  try {
    const salon = await salonsRepository.findById(salonId);
    const ownerPhone = await resolveOwnerNotifyPhone(salon);
    if (!ownerPhone) {
      logger.info(`[WA-AUTO] cash_counter_closed skipped — salon ${salonId} has no owner WhatsApp number on file`);
      return;
    }
    // Total Collection deliberately sums just these three lines (cash + card
    // + upi), not cash_revenue (cash-only, used elsewhere for the
    // reconciliation/variance math) — so the number always adds up to the
    // breakdown shown right above it. The three are rendered as ONE variable
    // (not three separate ones) to stay under Meta's too-many-variables-for-
    // this-length limit — but NOT as a multi-line value: Meta rejects a
    // parameter VALUE containing \n/\t or 4+ consecutive spaces outright
    // (error 132018), independent of whether the template's own approved
    // BODY text has real line breaks. bill_receipt's {{items}} avoids this
    // the same way — a single-line, comma-joined value, never \n-joined.
    const cashAmt = Number(counter.cash_amount ?? 0);
    const cardAmt = Number(counter.card_amount ?? 0);
    const upiAmt  = Number(counter.upi_amount ?? 0);
    const collectionBreakdown = `Cash: ${formatMoney(cashAmt)} | Card: ${formatMoney(cardAmt)} | UPI: ${formatMoney(upiAmt)}`;

    const variables = {
      "1": salon?.business_name ?? "your salon",
      "2": formatDateIST(counter.closed_at ?? new Date()),
      "3": formatTimeIST(counter.closed_at ?? new Date()),
      "4": collectionBreakdown,
      "5": formatMoney(cashAmt + cardAmt + upiAmt),
    };
    await whatsappAutomationService.trigger({
      salonId,
      eventType: "cash_counter_closed",
      clientId: null,
      phone: ownerPhone,
      countryCode: null,
      variables,
      referenceId: counter.id,
      referenceType: "cash_management",
      dedupeByReference: true,
    });
  } catch (err: any) {
    logger.error("[WA-AUTO] cash_counter_closed trigger failed:", err?.message ?? err);
  }
}

export const cashManagementService = {
  async openCounter(salonId: string, createdBy: string, body: OpenCounterBody) {
    if (!Number.isFinite(body.opening_balance) || body.opening_balance < 0) {
      throw new AppError(400, "opening_balance must be a non-negative number", "VALIDATION_ERROR");
    }

    const counter = await cashManagementRepository.openCounter({
      salonId,
      openingBalance: body.opening_balance,
      createdBy,
    });

    // Fire-and-forget — only reached once the open has actually committed, so
    // a validation/DB failure above (which throws) never triggers a message.
    notifyOwnerCashCounterOpened(salonId, counter).catch(() => {});

    return counter;
  },

  async getDashboardSummary(salonId: string, cashManagementId?: string) {
    return cashManagementRepository.getDashboardSummary(
      salonId,
      cashManagementId?.trim(),
    );
  },

  async listCashIncomeEntries(salonId: string, cashManagementId: string) {
    if (!cashManagementId?.trim()) {
      throw new AppError(400, "cash_management_id is required", "VALIDATION_ERROR");
    }
    return cashManagementRepository.listCashIncomeEntries({
      salonId,
      cashManagementId: cashManagementId.trim(),
    });
  },

  async listCounters(filters: CounterListFilters) {
    if (filters.status && !["open", "closed"].includes(filters.status)) {
      throw new AppError(400, "status must be open or closed", "VALIDATION_ERROR");
    }
    return cashManagementRepository.listCounters(filters);
  },

  async listExpenses(filters: ExpenseListFilters) {
    return cashManagementRepository.listExpenses(filters);
  },

  async createExpense(salonId: string, createdBy: string, body: CreateExpenseBody) {
    if (!body.cash_management_id?.trim()) {
      throw new AppError(400, "cash_management_id is required", "VALIDATION_ERROR");
    }
    if (!body.expense_type?.trim()) {
      throw new AppError(400, "expense_type is required", "VALIDATION_ERROR");
    }
    if (!Number.isFinite(body.amount) || body.amount < 0) {
      throw new AppError(400, "amount must be a non-negative number", "VALIDATION_ERROR");
    }

    return cashManagementRepository.createExpense({
      salonId,
      createdBy,
      body,
    });
  },

  async updateExpense(salonId: string, expenseId: string, body: UpdateExpenseBody) {
    if (!expenseId.trim()) {
      throw new AppError(400, "expense id is required", "VALIDATION_ERROR");
    }
    if (body.amount !== undefined && (!Number.isFinite(body.amount) || body.amount < 0)) {
      throw new AppError(400, "amount must be a non-negative number", "VALIDATION_ERROR");
    }
    if (body.expense_type !== undefined && !body.expense_type.trim()) {
      throw new AppError(400, "expense_type cannot be empty", "VALIDATION_ERROR");
    }

    return cashManagementRepository.updateExpense({
      salonId,
      expenseId: expenseId.trim(),
      body,
    });
  },

  async deleteExpense(salonId: string, expenseId: string) {
    if (!expenseId.trim()) {
      throw new AppError(400, "expense id is required", "VALIDATION_ERROR");
    }
    return cashManagementRepository.deleteExpense({
      salonId,
      expenseId: expenseId.trim(),
    });
  },

  async closeCounter(salonId: string, closedBy: string, body: CloseCounterBody) {
    if (!body.cash_management_id?.trim()) {
      throw new AppError(400, "cash_management_id is required", "VALIDATION_ERROR");
    }
    if (!Number.isFinite(body.in_store_cash) || body.in_store_cash < 0) {
      throw new AppError(400, "in_store_cash must be a non-negative number", "VALIDATION_ERROR");
    }

    const counter = await cashManagementRepository.closeCounter({
      salonId,
      cashManagementId: body.cash_management_id.trim(),
      inStoreCash: body.in_store_cash,
      remarks: body.remarks,
      closedBy,
    });

    // Fire-and-forget — only reached once the close has actually committed,
    // so a validation/DB failure above (which throws) never triggers a
    // message, and an already-closed/not-found counter never gets here either.
    notifyOwnerCashCounterClosed(salonId, counter).catch(() => {});

    return counter;
  },

  // Fetches only the sections the caller asked for, in parallel, so a page
  // that needs several of the cash-management/dashboard widgets at once can
  // do it in one round trip instead of four.
  async getSummaryBundle(salonId: string, body: SummaryBundleBody) {
    const sections = Array.isArray(body.sections) ? body.sections : [];
    if (!sections.length) {
      throw new AppError(400, "sections must be a non-empty array", "VALIDATION_ERROR");
    }
    const invalid = sections.filter((s) => !SUMMARY_BUNDLE_SECTIONS.includes(s));
    if (invalid.length) {
      throw new AppError(400, `Invalid section(s): ${invalid.join(", ")}`, "VALIDATION_ERROR");
    }

    const tasks: Partial<Record<SummaryBundleSection, Promise<unknown>>> = {};

    if (sections.includes("cash_dashboard")) {
      tasks.cash_dashboard = this.getDashboardSummary(salonId, body.cash_management_id);
    }
    if (sections.includes("cash_counters")) {
      tasks.cash_counters = this.listCounters({
        salonId,
        status: body.counters?.status,
        search: body.counters?.search,
        from: body.counters?.from,
        to: body.counters?.to,
        sortBy: body.counters?.sort_by,
        sortOrder: body.counters?.sort_order === "asc" ? "asc" : "desc",
        page: body.counters?.page,
        limit: body.counters?.limit,
      });
    }
    if (sections.includes("cash_expenses")) {
      tasks.cash_expenses = this.listExpenses({
        salonId,
        cashManagementId: body.expenses?.cash_management_id ?? body.cash_management_id,
        search: body.expenses?.search,
        sortBy: body.expenses?.sort_by,
        sortOrder: body.expenses?.sort_order === "asc" ? "asc" : "desc",
        page: body.expenses?.page,
        limit: body.expenses?.limit,
      });
    }
    if (sections.includes("dashboard_summary")) {
      tasks.dashboard_summary = salonDashboardService.getSummary(salonId);
    }

    const keys = Object.keys(tasks) as SummaryBundleSection[];
    const values = await Promise.all(keys.map((key) => tasks[key]));
    const result: Partial<Record<SummaryBundleSection, unknown>> = {};
    keys.forEach((key, i) => { result[key] = values[i]; });
    return result;
  },
};
