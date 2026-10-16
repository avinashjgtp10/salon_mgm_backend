import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { productScannerService } from "./product-scanner.service";
import { RecognitionInput } from "./product-scanner.types";

export function validateRecognition(req: Request, _res: Response, next: NextFunction): void {
  try {
    const body = req.body ?? {};
    if (body.barcode !== undefined && (typeof body.barcode !== "string" || !/^[A-Za-z0-9._-]{4,80}$/.test(body.barcode))) throw new AppError(400, "Invalid product barcode", "VALIDATION_ERROR");
    if (body.query !== undefined && (typeof body.query !== "string" || !body.query.trim() || body.query.length > 250)) throw new AppError(400, "Invalid product search", "VALIDATION_ERROR");
    if (!body.barcode && !body.query && !body.image) throw new AppError(400, "Provide a barcode, product search, or packaging photo", "VALIDATION_ERROR");
    if (body.image) {
      const image = body.image;
      if (!["image/jpeg", "image/png", "image/webp"].includes(image.mime_type) || typeof image.base64 !== "string" || image.base64.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw new AppError(400, "Provide a JPEG, PNG or WebP photo under 4.5 MB", "VALIDATION_ERROR");
    }
    // Explicit allowlist; provider URLs, IDs and credentials cannot be supplied.
    req.body = { barcode: body.barcode, query: body.query?.trim(), image: body.image ? { base64: body.image.base64, mime_type: body.image.mime_type } : undefined };
    next();
  } catch (e) { next(e); }
}
export async function recognizeAuditProduct(req: Request & { user?: { salonId?: string } }, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    const result = await productScannerService.recognize(String(req.params.id), req.user.salonId, req.body as RecognitionInput);
    sendSuccess(res, 200, result, "Product recognition completed; verify details before saving");
  } catch (e) { next(e); }
}
