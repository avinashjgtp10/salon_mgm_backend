import crypto from "crypto";
import { getRazorpayCredentials } from "../../config/razorpay";

// Which Razorpay account the server is talking to right now. Razorpay plan IDs belong to ONE account (and TEST and LIVE are
// different accounts), so every stored plan ID is tagged with this key and only ever read or written for the same key.
//
// The key is "<mode>:<10 hex chars of SHA-256(key id)>". The Razorpay key itself is never stored, logged or returned: only
// its one-way fingerprint, which is enough to tell two accounts apart.

export type RazorpayMode = "live" | "test" | "unknown";

export interface RazorpayAccount {
    mode: RazorpayMode;
    /** Stable fingerprint of the account, e.g. "test:3fa91c0b2e". */
    key: string;
}

export function accountFromKeyId(keyId: string | null | undefined): RazorpayAccount {
    keyId = keyId ?? "";
    const mode: RazorpayMode = keyId.startsWith("rzp_live_") ? "live" : keyId.startsWith("rzp_test_") ? "test" : "unknown";
    const fingerprint = crypto.createHash("sha256").update(keyId).digest("hex").slice(0, 10);
    return { mode, key: `${mode}:${fingerprint}` };
}

/** From the environment only (no database lookup). Used where the key in use is not needed, and by tests. */
export const currentRazorpayAccount = (env: NodeJS.ProcessEnv = process.env): RazorpayAccount => accountFromKeyId(env.RAZORPAY_KEY_ID);

/**
 * The account the server is actually talking to now: the key a Super Admin saved under Plans > Payment Gateway, or else the
 * RAZORPAY_KEY_ID environment variable (the same order getRazorpay() uses). Changing the saved key therefore changes the account key,
 * so plan IDs registered for the previous account are never reused for the new one.
 */
export async function getActiveRazorpayAccount(): Promise<RazorpayAccount> {
    return accountFromKeyId((await getRazorpayCredentials()).keyId);
}
