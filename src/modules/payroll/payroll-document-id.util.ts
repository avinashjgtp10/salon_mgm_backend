// Short, human-readable document IDs derived deterministically from the
// underlying row's UUID — re-downloading the same slip/receipt always shows
// the same ID (no counter table, no extra column), while still being
// effectively unique per document for support-conversation reference.
function shortCode(uuid: string): string {
    return uuid.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function buildSlipDocumentId(payrollEntryId: string, periodStart: string): string {
    return `SLIP-${periodStart.slice(0, 7)}-${shortCode(payrollEntryId)}`;
}

export function buildReceiptDocumentId(paymentId: string, periodStart: string): string {
    return `RCPT-${periodStart.slice(0, 7)}-${shortCode(paymentId)}`;
}
