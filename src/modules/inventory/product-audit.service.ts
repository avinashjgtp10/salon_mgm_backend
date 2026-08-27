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

export const productAuditService = {
    async create(params: { salonId: string; auditorId: string; body: CreateProductAuditBody }): Promise<ProductAuditWithDetail> {
        const { salonId, body } = params;
        if (!body.branch_id) throw new AppError(400, "branch_id is required", "VALIDATION_ERROR");
        if (!body.name || !body.name.trim()) throw new AppError(400, "name is required", "VALIDATION_ERROR");

        // Auditor defaults to whoever is creating the audit, but can be
        // assigned to a different staff member — same "creator picks an
        // assignee" convention as appointments' staff_id.
        let auditorId = params.auditorId;
        if (body.auditor_id && body.auditor_id !== params.auditorId) {
            const isMember = await productAuditRepository.isSalonMember(body.auditor_id, salonId);
            if (!isMember) throw new AppError(404, "auditor_id is not a staff member of this salon", "AUDITOR_NOT_FOUND");
            auditorId = body.auditor_id;
        }
        const created = await productAuditRepository.create(body, salonId, auditorId);
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

    async submitForReview(params: { auditId: string; salonId: string; actorId: string }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, actorId } = params;
        const audit = await getOwned(auditId, salonId);

        if (!ALLOWED_TRANSITIONS[audit.status].includes("pending_review")) {
            throw new AppError(409, `Cannot submit an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }
        if (audit.items.length === 0) {
            throw new AppError(400, "Add at least one product before submitting for review", "NO_PRODUCTS");
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
    async approve(params: { auditId: string; salonId: string; reviewerId: string; requestedReviewerId?: string }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, reviewerId, requestedReviewerId } = params;
        const audit = await getOwned(auditId, salonId);

        if (!ALLOWED_TRANSITIONS[audit.status].includes("complete")) {
            throw new AppError(409, `Cannot approve an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }

        let finalReviewerId = reviewerId;
        if (requestedReviewerId && requestedReviewerId !== reviewerId) {
            const isMember = await productAuditRepository.isSalonMember(requestedReviewerId, salonId);
            if (!isMember) throw new AppError(404, "reviewer_id is not a staff member of this salon", "REVIEWER_NOT_FOUND");
            finalReviewerId = requestedReviewerId;
        }
        if (audit.auditor_id === finalReviewerId) {
            throw new AppError(403, "An audit must be reviewed by someone other than the auditor", "SELF_REVIEW_NOT_ALLOWED");
        }

        await productAuditRepository.transitionStatus(auditId, salonId, {
            status: "complete", reviewer_id: finalReviewerId, rejection_reason: null,
        });
        await productAuditRepository.addHistory(auditId, finalReviewerId, "Review approved", "All differences verified and accepted");
        return getOwned(auditId, salonId);
    },

    async reject(params: {
        auditId: string; salonId: string; reviewerId: string; requestedReviewerId?: string; reason: string;
    }): Promise<ProductAuditWithDetail> {
        const { auditId, salonId, reviewerId, requestedReviewerId, reason } = params;
        if (!reason || !reason.trim()) throw new AppError(400, "Rejection reason is required", "VALIDATION_ERROR");

        const audit = await getOwned(auditId, salonId);
        if (!ALLOWED_TRANSITIONS[audit.status].includes("rejected")) {
            throw new AppError(409, `Cannot reject an audit that is ${audit.status}`, "INVALID_TRANSITION");
        }

        let finalReviewerId = reviewerId;
        if (requestedReviewerId && requestedReviewerId !== reviewerId) {
            const isMember = await productAuditRepository.isSalonMember(requestedReviewerId, salonId);
            if (!isMember) throw new AppError(404, "reviewer_id is not a staff member of this salon", "REVIEWER_NOT_FOUND");
            finalReviewerId = requestedReviewerId;
        }
        if (audit.auditor_id === finalReviewerId) {
            throw new AppError(403, "An audit must be reviewed by someone other than the auditor", "SELF_REVIEW_NOT_ALLOWED");
        }

        await productAuditRepository.transitionStatus(auditId, salonId, {
            status: "rejected", reviewer_id: finalReviewerId, rejection_reason: reason.trim(),
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
