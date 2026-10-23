import axios from "axios";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import logger from "../../config/logger";
import { s3, BUCKET } from "../utils/avatar.upload";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1)/i;

// Loads the salon logo bytes from wherever the app stores it: the S3 media proxy path,
// the local /uploads folder, or a public https URL. Returns a small PNG, or null — a missing
// or broken logo must never stop a poster from being made.
export async function loadLogo(logoUrl: string | null | undefined): Promise<Buffer | null> {
    const url = (logoUrl ?? "").trim();
    if (!url) return null;
    try {
        let raw: Buffer | null = null;

        if (url.startsWith("/api/v1/media/")) {
            const key = decodeURIComponent(url.slice("/api/v1/media/".length));
            if (!BUCKET || key.includes("..")) return null;
            const obj = await s3.getObject({ Bucket: BUCKET, Key: key }).promise();
            raw = Buffer.from(obj.Body as Buffer);
        } else if (url.startsWith("/uploads/")) {
            const file = path.basename(url);
            const full = path.join(process.cwd(), "uploads", file);
            if (fs.existsSync(full)) raw = fs.readFileSync(full);
        } else if (/^https:\/\//i.test(url)) {
            const host = new URL(url).hostname;
            if (PRIVATE_HOST.test(host)) return null;
            const res = await axios.get<ArrayBuffer>(url, {
                responseType: "arraybuffer",
                timeout: 10_000,
                maxContentLength: 5 * 1024 * 1024,
                maxRedirects: 2,
            });
            raw = Buffer.from(res.data);
        }

        if (!raw) return null;
        return await sharp(raw).resize(220, 220, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    } catch (err: any) {
        logger.warn("[ai-assistant] could not load salon logo for poster", { error: err?.message });
        return null;
    }
}
