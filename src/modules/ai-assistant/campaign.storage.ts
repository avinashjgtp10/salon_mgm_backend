import crypto from "crypto";
import fs from "fs";
import path from "path";
import logger from "../../config/logger";
import { s3, BUCKET } from "../utils/avatar.upload";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Stores a generated poster and returns the same kind of relative URL the rest
// of the app uses for private images (S3 via the /api/v1/media proxy, or the
// local /uploads folder when no bucket is configured).
export async function storePoster(salonId: string, buffer: Buffer, contentType: string): Promise<string> {
    const ext = EXT[contentType] ?? "png";
    const name = `${crypto.randomUUID()}.${ext}`;

    if (BUCKET) {
        const key = `ai-campaigns/${salonId}/${name}`;
        await s3.upload({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }).promise();
        return `/api/v1/media/${key}`;
    }

    logger.warn("[ai-assistant] AWS_S3_BUCKET not set — storing poster locally");
    const dir = path.join(process.cwd(), "uploads");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `ai-campaign-${salonId}-${name}`), buffer);
    return `/uploads/ai-campaign-${salonId}-${name}`;
}
