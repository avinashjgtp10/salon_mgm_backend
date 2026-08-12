import crypto from "crypto";
import { AppError } from "../../middleware/error.middleware";

// Signs a per-appointment feedback-form token, same "no extra table" pattern
// as bookings.service.ts's generateManageToken/assertManageToken — a client
// can rate their visit from the WhatsApp review_request button without an
// account, and the token is just an HMAC of the appointment id. Distinct
// salt string ("feedback:") so a booking-manage token can't double as one.
const FEEDBACK_TOKEN_SECRET =
    process.env.BOOKING_MANAGE_SECRET || process.env.JWT_ACCESS_SECRET || "dev-booking-manage-secret";

export function generateFeedbackToken(appointmentId: string): string {
    return crypto.createHmac("sha256", FEEDBACK_TOKEN_SECRET).update(`feedback:${appointmentId}`).digest("hex");
}

export function assertFeedbackToken(appointmentId: string, token: string | undefined | null): void {
    const expected = generateFeedbackToken(appointmentId);
    const provided = Buffer.from(String(token || ""));
    const expectedBuf = Buffer.from(expected);
    const valid =
        provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);
    if (!valid) throw new AppError(403, "Invalid or expired feedback link", "FORBIDDEN");
}

// Parses the "{appointmentId}.{hmac}" slug used in the Meta button URL and
// the frontend route — the whole slug is Meta's per-recipient dynamic URL
// suffix, so it has to be one opaque path segment, not separate params.
export function parseFeedbackSlug(slug: string): { appointmentId: string; token: string } {
    const idx = slug.lastIndexOf(".");
    if (idx < 0) throw new AppError(400, "Malformed feedback link", "VALIDATION_ERROR");
    return { appointmentId: slug.slice(0, idx), token: slug.slice(idx + 1) };
}
