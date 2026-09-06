import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { s3, BUCKET } from "../utils/avatar.upload";

// Streams a private S3 object (staff/client avatars, business logos, cover
// photos, gallery images — all uploaded via avatar.upload.ts) through our
// own backend, since the bucket has no public-read policy. Public route —
// these are business-facing images shown on invoices/receipts/the public
// booking page, same audience as the old direct-S3/local-disk URLs were.
export const mediaController = {
    async get(req: Request, res: Response, next: NextFunction) {
        try {
            const key = (req.params as any)[0] as string;
            if (!key) throw new AppError(400, "No media key provided", "VALIDATION_ERROR");
            if (!BUCKET) throw new AppError(404, "Media not found", "NOT_FOUND");

            const data = await s3.getObject({ Bucket: BUCKET, Key: key }).promise();

            res.set("Content-Type", data.ContentType || "application/octet-stream");
            res.set("Cache-Control", "public, max-age=31536000, immutable");
            // helmet() defaults this to "same-origin" globally, which blocks the
            // browser from rendering this as an <img> whenever the page's origin
            // differs from config.publicBaseUrl's (e.g. localhost:5173 vs the
            // ngrok tunnel domain) — these are public-facing images, so opt out.
            res.set("Cross-Origin-Resource-Policy", "cross-origin");
            return res.send(data.Body);
        } catch (err: any) {
            if (err?.code === "NoSuchKey" || err?.code === "NotFound") {
                return next(new AppError(404, "Media not found", "NOT_FOUND"));
            }
            return next(err);
        }
    },
};
