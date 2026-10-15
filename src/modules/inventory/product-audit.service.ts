import { AppError } from "../../middleware/error.middleware";
import { productAuditRepository } from "./product-audit.repository";
import {
    ProductAuditWithDetail, ProductAuditStatus,
    CreateProductAuditBody, ListProductAuditsFilters,
} from "./product-audit.types";

// Workflow: in_progress -> pending_review -> complete
//                        pending_review -> rejected -> in_progress
// Enforced here (not just in the UI) so a direct API call can't skip a step.
const ALLOWED_TRANSITIONS: Record<ProductAuditStatus, ProductAuditStatus[]> = {
    in_progress: ["pending_review"],
    pending_review: ["complete", "rejected"],
    complete: [],
    rejected: ["in_progress"],
};

function assertEditable(status: ProductAuditStatus) {
    if (status !== "in_progress") {
        throw new AppError(409, "This audit is not editable in its current status", "AUDIT_NOT_EDITABLE");
    }
}

async function getOwned(auditId: string, salonId: string): Promise<ProductAuditWithDetail> {
    const audit = await productAuditRepository.getById(auditId, salonId);
    if (!audit) throw new AppError(404, "Audit not found", "AUDIT_NOT_FOUND");
    return audit;
}

// Who an audit is recorded against. `recordUserId` goes in the NOT NULL auditor_id / reviewer_id column
// (the staff member's own login when they have one, else whoever is acting); `staffId` says which staff
// member it really was; `loginUserId` is that staff member's login (null when they have none) and is
// only used to tell whether two roles are the same person.
type AuditPerson = { recordUserId: string; staffId: string | null; loginUserId: string | null };

async function resolvePerson(opts: {
    staffId?: string; userId?: string; actingUserId: string; salonId: string;
    notFoundMessage: string; notFoundCode: string;
}): Promise<AuditPerson> {
    const { staffId, userId, actingUserId, salonId } = opts;
    if (staffId) {
        const row = await productAuditRepository.findStaff(staffId, salonId);
        if (!row || row.is_active === false) throw new AppError(404, opts.notFoundMessage, opts.notFoundCode);
        return { recordUserId: row.user_id ?? actingUserId, staffId: row.id, loginUserId: row.user_id };
    }
    // Older callers (and the mobile app) still send a user id.
    const chosenUser = userId && userId !== actingUserId ? userId : actingUserId;
    if (chosenUser !== actingUserId && !(await productAuditRepository.isSalonMember(chosenUser, salonId))) {
        throw new AppError(404, opts.notFoundMessage, opts.notFoundCode);
    }
    return { recordUserId: chosenUser, staffId: await productAuditRepository.staffIdForUser(chosenUser, salonId), loginUserId: chosenUser };
}

// The same human? Compare staff members when both are known, otherwise compare logins. A staff member with
// no login never matches on login, so a manager can review an audit that was recorded for them.
function isSamePerson(a: { staffId: string | null; loginUserId: string | null }, b: { staffId: string | null; loginUserId: string | null }): boolean {
    if (a.staffId && b.staffId) return a.staffId === b.staffId;
    return !!a.loginUserId && !!b.loginUserId && a.loginUserId === b.loginUserId;
}

async function auditAuditor(audit: { auditor_id: string; auditor_staff_id?: string | null }, salonId: string): Promise<{ staffId: string | null; loginUserId: string | null }> {
    if (!audit.auditor_staff_id) return { staffId: null, loginUserId: audit.auditor_id };
    const row = await productAuditRepository.findStaff(audit.auditor_staff_id, salonId);
    return { staffId: audit.auditor_staff_id, loginUserId: row?.user_id ?? null };
}

export const productAuditService = {
    async create(params: { salonId: string; auditorId: string; body: CreateProductAuditBody }): Promise<ProductAuditWithDetail> {
        const { salonId, body } = params;
        if (!body.branch_id) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        if (!body.name || !body.name.trim()) throw new AppError(400, "name is required", "VALIDATION_ERROR");

        // Auditor defaults to whoever is creating the audit, but can be
        // assigned to a different staff member — same "creator picks an
        // assignee" convention as appointments' staff_id.
        const auditor = await resolvePerson({
            staffId: body.auditor_staff_id, userId: body.auditor_id, actingUserId: params.auditorId, salonId,
            notFoundMessage: "auditor is not a staff member of this salon", notFoundCode: "AUDITOR_NOT_FOUND",
        });
        const created = await productAuditRepository.create(body, salonId, auditor.recordUserId, auditor.staffId);
        // create() only returns the header row's raw shape server-side; refetch
        // through getById so the caller always gets the same envelope
        // (items/history included) as every other read.
        return getOwned(created.id, salonId);
    },

    async list(filters: ListProductAuditsFilters, salonId: string) {
        return productAuditRepository.list(filters, salonId);
    },

    async getById(auditId: string, salonId: string): Promise<ProductAuditWithDetail> {
        return getOwned(auditId, salonId);
    },

    async delete(auditId: string, salonId: string): Promise<void> {
        await getOwned(auditId, salonId);
        await productAuditRepository.delete(auditId, salonId);
    },

    async addItems(params: { auditId: string; salonId: string; productIds: string[] }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, productIds } = params;
        const audit = await getOwned(auditId, salonId);
        assertEditable(audit.status);
        if (!productIds?.length) throw new AppError(400, "product_ids is required", "VALIDATION_ERROR");

        try {
            await productAuditRepository.addItems(auditId, productIds, salonId);
        } catch (err: any) {
            if (typeof err?.message === "string" && err.message.includes("not found in this salon")) {
                throw new AppError(404, err.message, "PRODUCT_NOT_FOUND");
            }
            throw err;
        }
        return getOwned(auditId, salonId);
    },

    async removeItem(params: { auditId: string; itemId: string; salonId: string }): Promise<ProductAuditWithDetail> {
        const { auditId, itemId, salonId } = params;
        const audit = await getOwned(auditId, salonId);
        assertEditable(audit.status);
        await productAuditRepository.removeItem(auditId, itemId);
        return getOwned(auditId, salonId);
    },

    async updateItem(params: {
        auditId: string; itemId: string; salonId: string;
        physicalQty: number | null; reason: string | null;
    }): Promise<ProductAuditWithDetail> {
        const { auditId, itemId, salonId, physicalQty, reason } = params;
        const audit = await getOwned(auditId, salonId);
        assertEditable(audit.status);

        if (physicalQty != null && !Number.isFinite(physicalQty)) {
            throw new AppError(400, "physical_qty must be a number", "VALIDATION_ERROR");
        }

        const item = audit.items.find((i) => i.id === itemId);
        if (!item) throw new AppError(404, "Audit item not found", "AUDIT_ITEM_NOT_FOUND");

        // Reason required whenever difference != 0 — enforced server-side too,
        // not just as a Submit-for-Review gate, so a direct PATCH can't smuggle
        // in an unexplained difference.
        const diff = physicalQty == null ? null : physicalQty - item.system_qty;
        if (diff != null && diff !== 0 && !(reason ?? "").trim()) {
            throw new AppError(400, "Reason is required when physical quantity differs from system quantity", "REASON_REQUIRED");
        }

        const updated = await productAuditRepository.updateItem(auditId, itemId, physicalQty, reason?.trim() || null);
        if (!updated) throw new AppError(404, "Audit item not found", "AUDIT_ITEM_NOT_FOUND");
        return getOwned(auditId, salonId);
    },

    async submitForReview(params: {
        auditId: string; salonId: string; actorId: string;
        // Every locally-edited row's latest value — the frontend keeps edits
        // in local state while the user works and only calls the API here,
        // once, at Submit (see ProductAuditDetailsModal.tsx), instead of a
        // PATCH per field/row.
        items?: { item_id: string; physical_qty: number | null; reason?: string | null }[];
    }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, actorId, items } = params;
        const audit = await getOwned(auditId, salonId);

        if (!ALLOWED_TRANSITIONS[audit.status].includes("pending_review")) {
            throw new AppError(409, `Cannot submit an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }
        if (audit.items.length === 0) {
            throw new AppError(400, "Add at least one product before submitting for review", "NO_PRODUCTS");
        }

        if (items && items.length > 0) {
            const itemsById = new Map(audit.items.map((i) => [i.id, i]));
            // Validated up front (same REASON_REQUIRED rule updateItem() enforces)
            // before writing anything, so a bad row in the batch can't leave the
            // audit with some items saved and others silently skipped.
            for (const upd of items) {
                const item = itemsById.get(upd.item_id);
                if (!item) throw new AppError(404, "Audit item not found", "AUDIT_ITEM_NOT_FOUND");
                if (upd.physical_qty != null && !Number.isFinite(upd.physical_qty)) {
                    throw new AppError(400, "physical_qty must be a number", "VALIDATION_ERROR");
                }
                const diff = upd.physical_qty == null ? null : upd.physical_qty - item.system_qty;
                if (diff != null && diff !== 0 && !(upd.reason ?? "").trim()) {
                    throw new AppError(400, "Reason is required when physical quantity differs from system quantity", "REASON_REQUIRED");
                }
            }
            await productAuditRepository.updateItems(
                auditId,
                items.map((upd) => ({
                    itemId: upd.item_id,
                    physicalQty: upd.physical_qty,
                    reason: (upd.reason ?? "").trim() || null,
                })),
            );
        }

        const missingReasons = await productAuditRepository.countMissingReasons(auditId);
        if (missingReasons > 0) {
            throw new AppError(400, `${missingReasons} product(s) have a difference but no reason`, "REASON_REQUIRED");
        }

        await productAuditRepository.transitionStatus(auditId, salonId, { status: "pending_review" });
        await productAuditRepository.addHistory(auditId, actorId, "Submitted for review");
        return getOwned(auditId, salonId);
    },

    // reviewerId is who's actually clicking Approve; requestedReviewerId is an
    // optional "record someone else as the reviewer" override (e.g. a manager
    // approving on a colleague's behalf) — same pattern as auditor_id on
    // create. Both still go through the same salon-membership + self-review
    // checks regardless of which one ends up recorded.
    async approve(params: { auditId: string; salonId: string; reviewerId: string; requestedReviewerId?: string; requestedReviewerStaffId?: string }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, reviewerId, requestedReviewerId, requestedReviewerStaffId } = params;
        const audit = await getOwned(auditId, salonId);

        if (!ALLOWED_TRANSITIONS[audit.status].includes("complete")) {
            throw new AppError(409, `Cannot approve an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }

        const reviewer = await resolvePerson({
            staffId: requestedReviewerStaffId, userId: requestedReviewerId, actingUserId: reviewerId, salonId,
            notFoundMessage: "reviewer is not a staff member of this salon", notFoundCode: "REVIEWER_NOT_FOUND",
        });
        if (isSamePerson(await auditAuditor(audit, salonId), reviewer)) {
            throw new AppError(403, "An audit must be reviewed by someone other than the auditor", "SELF_REVIEW_NOT_ALLOWED");
        }
        const finalReviewerId = reviewer.recordUserId;

        // Approval is the moment the physical count becomes the official
        // stock — this applies every item's variance to products.amount and
        // writes the matching Stock Ledger entries atomically with the status
        // flip, not just a status change. See approveWithAdjustments.
        await productAuditRepository.approveWithAdjustments(auditId, salonId, finalReviewerId, reviewer.staffId);
        return getOwned(auditId, salonId);
    },

    async reject(params: {
        auditId: string; salonId: string; reviewerId: string; requestedReviewerId?: string; requestedReviewerStaffId?: string; reason: string;
    }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, reviewerId, requestedReviewerId, requestedReviewerStaffId, reason } = params;
        if (!reason || !reason.trim()) throw new AppError(400, "Rejection reason is required", "VALIDATION_ERROR");

        const audit = await getOwned(auditId, salonId);
        if (!ALLOWED_TRANSITIONS[audit.status].includes("rejected")) {
            throw new AppError(409, `Cannot reject an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }

        const reviewer = await resolvePerson({
            staffId: requestedReviewerStaffId, userId: requestedReviewerId, actingUserId: reviewerId, salonId,
            notFoundMessage: "reviewer is not a staff member of this salon", notFoundCode: "REVIEWER_NOT_FOUND",
        });
        if (isSamePerson(await auditAuditor(audit, salonId), reviewer)) {
            throw new AppError(403, "An audit must be reviewed by someone other than the auditor", "SELF_REVIEW_NOT_ALLOWED");
        }
        const finalReviewerId = reviewer.recordUserId;

        await productAuditRepository.transitionStatus(auditId, salonId, {
            status: "rejected", reviewer_id: finalReviewerId, reviewer_staff_id: reviewer.staffId, rejection_reason: reason.trim(),
        });
        await productAuditRepository.addHistory(auditId, finalReviewerId, "Rejected", reason.trim());
        return getOwned(auditId, salonId);
    },

    async reopen(params: { auditId: string; salonId: string; actorId: string }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, actorId } = params;
        const audit = await getOwned(auditId, salonId);

        if (!ALLOWED_TRANSITIONS[audit.status].includes("in_progress")) {
            throw new AppError(409, `Cannot reopen an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }

        await productAuditRepository.transitionStatus(auditId, salonId, {
            status: "in_progress", rejection_reason: null,
        });
        await productAuditRepository.addHistory(auditId, actorId, "Reopened for recount");
        return getOwned(auditId, salonId);
    },
};
