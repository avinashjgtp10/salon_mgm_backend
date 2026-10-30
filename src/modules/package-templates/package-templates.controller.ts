import { Request, Response, NextFunction } from "express";
import { packageTemplatesService } from "./package-templates.service";
import { sendSuccess } from "../utils/response.util";
import { AppError } from "../../middleware/error.middleware";
import csvParser from "csv-parser";
import { Readable } from "stream";
import * as XLSX from "xlsx";
import { packageTemplatesImport } from "./package-templates.import";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  return salonId;
};


function parseCSVBuffer(buffer: Buffer): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const rows: any[] = [];
    Readable.from(buffer).pipe(csvParser()).on("data", (r) => rows.push(r)).on("end", () => resolve(rows)).on("error", reject);
  });
}

function parseExcelBuffer(buffer: Buffer): any[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

export const packageTemplatesController = {

  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.list(salonId);
      return sendSuccess(res, 200, data, "Package templates fetched");
    } catch (e) { return next(e); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.getById(req.params.id as string, salonId);
      return sendSuccess(res, 200, data, "Package template fetched");
    } catch (e) { return next(e); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.create(salonId, req.body);
      return sendSuccess(res, 201, data, "Package template created");
    } catch (e) { return next(e); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await packageTemplatesService.update(req.params.id as string, salonId, req.body);
      return sendSuccess(res, 200, data, "Package template updated");
    } catch (e) { return next(e); }
  },

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      await packageTemplatesService.delete(req.params.id as string, salonId);
      return sendSuccess(res, 200, null, "Package template deleted");
    } catch (e) { return next(e); }
  },

  async import(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) throw new AppError(400, "file is required", "VALIDATION_ERROR");
      const name = file.originalname.toLowerCase();
      const rows = (name.endsWith(".xlsx") || name.endsWith(".xls"))
        ? parseExcelBuffer(file.buffer)
        : await parseCSVBuffer(file.buffer);
      const data = await packageTemplatesImport.importPackages({ rows, salonId });
      return sendSuccess(res, 200, data, "Import completed");
    } catch (e) { return next(e); }
  },
};
