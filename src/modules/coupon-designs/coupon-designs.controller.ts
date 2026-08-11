import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import config from '../../config/env';
import { couponDesignsService } from './coupon-designs.service';
import { designExportService } from './design-export.service';
import { DesignKind, DesignStatus } from './coupon-designs.types';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

const requireSalon = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
  return salonId;
};

export const couponDesignsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      const designs = await couponDesignsService.list(salonId, {
        kind: req.query.kind as DesignKind | undefined,
        status: req.query.status as DesignStatus | undefined,
        search: req.query.search ? String(req.query.search) : undefined,
      });
      return sendSuccess(res, 200, designs, 'Designs fetched successfully');
    } catch (err) { return next(err); }
  },

  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      const design = await couponDesignsService.get(String(req.params.id), salonId);
      return sendSuccess(res, 200, design, 'Design fetched successfully');
    } catch (err) { return next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      const design = await couponDesignsService.create(req.body, salonId, req.user?.userId ?? null);
      return sendSuccess(res, 201, design, 'Design created successfully');
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      const design = await couponDesignsService.update(String(req.params.id), req.body, salonId);
      return sendSuccess(res, 200, design, 'Design saved');
    } catch (err) { return next(err); }
  },

  async duplicate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      const design = await couponDesignsService.duplicate(
        String(req.params.id),
        salonId,
        req.user?.userId ?? null,
        req.body?.name,
      );
      return sendSuccess(res, 201, design, 'Design duplicated successfully');
    } catch (err) { return next(err); }
  },

  async exportDesign(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      const design = await couponDesignsService.get(String(req.params.id), salonId);

      const format = String(req.body?.format ?? "png").toLowerCase();
      if (!["png", "jpeg", "pdf"].includes(format))
        throw new AppError(400, "format must be png, jpeg or pdf", "VALIDATION_ERROR");

      const dpi = Number(req.body?.dpi ?? 72);
      if (![72, 150, 300].includes(dpi))
        throw new AppError(400, "dpi must be 72, 150 or 300", "VALIDATION_ERROR");

      const perPage = req.body?.perPage ? Number(req.body.perPage) : null;
      if (perPage !== null && ![1, 2, 4, 6, 8, 10, 12].includes(perPage))
        throw new AppError(400, "perPage must be 1, 2, 4, 6, 8, 10 or 12", "VALIDATION_ERROR");

      const result = await designExportService.export(
        design.doc as unknown as Record<string, unknown>,
        {
          format: format as "png" | "jpeg" | "pdf",
          dpi: dpi as 72 | 150 | 300,
          values: (req.body?.values ?? {}) as Record<string, string>,
          title: design.name,
          sheet: perPage ? { perPage: perPage as 1, cropMarks: Boolean(req.body?.cropMarks) } : null,
        },
      );

      // Served from the same static /uploads mount the rest of the app uses.
      return sendSuccess(res, 200, {
        url: `${config.publicBaseUrl}/uploads/designs/${result.fileName}`,
        fileName: result.fileName,
        bytes: result.bytes,
        // Surfaced so the UI can say "2 fields had no value" rather than
        // shipping a coupon with a blank where the code should be.
        missingTokens: result.missingTokens,
      }, "Design exported");
    } catch (err) { return next(err); }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = requireSalon(req);
      await couponDesignsService.remove(String(req.params.id), salonId);
      return sendSuccess(res, 200, null, 'Design deleted successfully');
    } catch (err) { return next(err); }
  },
};
