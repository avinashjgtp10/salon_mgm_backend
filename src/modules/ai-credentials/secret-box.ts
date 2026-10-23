import crypto from "crypto";
import config from "../../config/env";

// AES-256-GCM for secrets that must be stored but never shown again (here: per-salon AI API tokens).
// No extra setting is needed: the key is derived from the JWT_SECRET the server already has (with a purpose label, so it is
// a different key from the one that signs logins). AI_CREDENTIALS_KEY can optionally override it. If JWT_SECRET is ever
// rotated, saved tokens become unreadable and must be pasted again in Super Admin.
// Stored format: v1:<iv>:<auth tag>:<ciphertext>, all base64. A wrong key or tampered value fails closed.
const baseSecret = (): string => process.env.AI_CREDENTIALS_KEY || config.jwt.secret || "";

const keyFromEnv = (): Buffer => {
    const secret = baseSecret();
    if (secret.length < 8) throw new Error("No server secret available to encrypt with (JWT_SECRET is missing or too short)");
    return crypto.createHash("sha256").update(`salonox-ai-credentials:v1:${secret}`).digest();
};

export const secretBoxConfigured = (): boolean => baseSecret().length >= 8;

export function encryptSecret(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyFromEnv(), iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
    const [v, iv, tag, data] = stored.split(":");
    if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromEnv(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
