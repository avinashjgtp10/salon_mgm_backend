// src/modules/clients/clients.controller.ts
import { NextFunction, Request, Response } from "express";
import csvParser from "csv-parser";
import { Readable } from "stream";
import * as XLSX from "xlsx";
import { Parser as Json2CsvParser } from "json2csv";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { clientsService } from "./clients.service";
import { ClientsListQuery, CreateClientBody, UpdateClientBody } from "./clients.types";

type AuthRequest = Request & { user?: { userId: string; role?: string } };

const parseCSVBuffer = async (buffer: Buffer): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const results: any[] = [];
        Readable.from(buffer)
            .pipe(csvParser({ mapHeaders: ({ header }) => String(header || "").trim() }))
            .on("data", (row: any) => results.push(row))
            .on("end", () => resolve(results))
            .on("error", (err) => reject(err));
    });
};

const parseExcelBuffer = (buffer: Buffer): any[] => {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(ws, { defval: null });
};

export const clientsController = {
    // GET /api/v1/clients
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const q: ClientsListQuery = {
                offset: req.query.offset !== undefined ? Number(String(req.query.offset)) : undefined,
                limit: req.query.limit !== undefined ? Number(String(req.query.limit)) : undefined,
                sort_by: req.query.sort_by as any,
                sort_order: req.query.sort_order as any,
                search: req.query.search ? String(req.query.search) : undefined,
                inactive: String(req.query.inactive || "").toLowerCase() === "true",
                created_from: req.query.created_from ? String(req.query.created_from) : undefined,
                created_to: req.query.created_to ? String(req.query.created_to) : undefined,
                source: req.query.source ? String(req.query.source) : undefined,
                client_group: req.query.client_group ? (String(req.query.client_group) as any) : undefined,
                gender: req.query.gender ? (String(req.query.gender) as any) : undefined,
            };

            const data = await clientsService.list(q);
            return sendSuccess(res, 200, data, "Clients fetched successfully");
        } catch (e) {
            return next(e);
        }
    },

    // POST /api/v1/clients
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const body = req.body as CreateClientBody;
            const created = await clientsService.create(body);
            return sendSuccess(res, 201, created, "Client created successfully");
        } catch (e) {
            return next(e);
        }
    },

    // GET /api/v1/clients/:clientId?include=addresses,emergency_contacts
    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");

            // Validate UUID format to prevent database syntax errors
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
            if (!isUUID) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");

            const include = req.query.include ? String(req.query.include) : "";
            const data = await clientsService.getById(clientId, include);
            return sendSuccess(res, 200, data, "Client fetched successfully");
        } catch (e) {
            return next(e);
        }
    },

    // PATCH /api/v1/clients/:clientId
    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");

            // Validate UUID format to prevent database syntax errors
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
            if (!isUUID) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");

            const patch = req.body as UpdateClientBody;
            const updated = await clientsService.update(clientId, patch);
            return sendSuccess(res, 200, updated, "Client updated successfully");
        } catch (e) {
            return next(e);
        }
    },

    // DELETE /api/v1/clients/:clientId?hard=true|false
    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");

            // Validate UUID format to prevent database syntax errors
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
            if (!isUUID) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");

            const hard = String(req.query.hard || "").toLowerCase() === "true";
            await clientsService.remove(clientId, hard);

            return sendSuccess(res, 200, {}, hard ? "Client deleted successfully" : "Client archived successfully");
        } catch (e) {
            return next(e);
        }
    },

    // POST /api/v1/clients/import  (multipart/form-data)
    async import(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "file is required", "VALIDATION_ERROR");

            const file_type = req.body.file_type ? String(req.body.file_type) : undefined;
            const mode = (req.body.mode ? String(req.body.mode) : "upsert") as "create_only" | "upsert";
            const dry_run = String(req.body.dry_run || "").toLowerCase() === "true";

            const name = file.originalname.toLowerCase();

            let rows: any[] = [];
            if (file_type === "excel" || name.endsWith(".xlsx") || name.endsWith(".xls")) rows = parseExcelBuffer(file.buffer);
            else rows = await parseCSVBuffer(file.buffer);

            const result = await clientsService.importClients({ rows, mode, dry_run });
            return sendSuccess(res, 200, result, "Import completed");
        } catch (e) {
            return next(e);
        }
    },

    // GET /api/v1/clients/duplicates?phone_number=+91XXXXXXXXXX
    async findDuplicates(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const phone_number = req.query.phone_number
                ? String(req.query.phone_number).trim()
                : "";

            if (!phone_number)
                throw new AppError(
                    400,
                    "phone_number query param is required",
                    "VALIDATION_ERROR"
                );

            const duplicates = await clientsService.findDuplicatesByPhone(phone_number);
            return sendSuccess(res, 200, duplicates, "Duplicates fetched successfully");
        } catch (e) {
            return next(e);
        }
    },

    // POST /api/v1/clients/merge
    async merge(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const result = await clientsService.mergeClients(req.body);
            return sendSuccess(res, 200, result, "Clients merged successfully");
        } catch (e) {
            return next(e);
        }
    },

    // POST /api/v1/clients/merge-duplicates
    async mergeAllDuplicates(_req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const result = await clientsService.mergeAllDuplicates();
            return sendSuccess(
                res,
                200,
                result,
                result.total_groups === 0
                    ? "No duplicate clients found"
                    : `Merged ${result.total_merged} duplicate groups, archived ${result.total_archived} clients`
            );
        } catch (e) {
            return next(e);
        }
    },

    // POST /api/v1/clients/block
    async block(req: Request, res: Response, next: NextFunction) {
        try {
            const { client_ids, reason } = req.body;
            await clientsService.blockClients(client_ids, reason);
            return sendSuccess(res, 200, {}, "Clients blocked");
        } catch (e) {
            return next(e);
        }
    },

    // GET /api/v1/clients/export?format=csv|excel + same filters as list
    async export(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const format = String(req.query.format || "").toLowerCase();
            if (!["csv", "excel"].includes(format)) throw new AppError(400, "format must be csv or excel", "VALIDATION_ERROR");

            const q: ClientsListQuery = {
                offset: req.query.offset !== undefined ? Number(String(req.query.offset)) : 0,
                limit: req.query.limit !== undefined ? Number(String(req.query.limit)) : 200, // export default
                sort_by: req.query.sort_by as any,
                sort_order: req.query.sort_order as any,
                search: req.query.search ? String(req.query.search) : undefined,
                inactive: String(req.query.inactive || "").toLowerCase() === "true",
                created_from: req.query.created_from ? String(req.query.created_from) : undefined,
                created_to: req.query.created_to ? String(req.query.created_to) : undefined,
                source: req.query.source ? String(req.query.source) : undefined,
                client_group: req.query.client_group ? (String(req.query.client_group) as any) : undefined,
                gender: req.query.gender ? (String(req.query.gender) as any) : undefined,
            };

            const data = await clientsService.list(q);

            // flatten export
            const rows = data.items.map((c: any) => ({
                id: c.id,
                first_name: c.first_name,
                last_name: c.last_name,
                full_name: c.full_name,
                email: c.email,
                phone_country_code: c.phone_country_code,
                phone_number: c.phone_number,
                additional_email: c.additional_email,
                additional_phone_country_code: c.additional_phone_country_code,
                additional_phone_number: c.additional_phone_number,
                birthday_day_month: c.birthday_day_month,
                birthday_year: c.birthday_year,
                gender: c.gender,
                pronouns: c.pronouns,
                client_source: c.client_source,
                referred_by_client_id: c.referred_by_client_id,
                preferred_language: c.preferred_language,
                occupation: c.occupation,
                country: c.country,
                avatar_url: c.avatar_url,
                total_sales: c.total_sales,
                reviews_avg: c.reviews_avg,
                reviews_count: c.reviews_count,
                is_active: c.is_active,
                block_reason: c.block_reason,
                email_notifications: c.email_notifications,
                sms_notifications: c.sms_notifications,
                whatsapp_notifications: c.whatsapp_notifications,
                email_marketing: c.email_marketing,
                sms_marketing: c.sms_marketing,
                whatsapp_marketing: c.whatsapp_marketing,
                created_at: c.created_at,
                updated_at: c.updated_at,
            }));

            if (format === "csv") {
                const parser = new Json2CsvParser({ withBOM: true });
                const csv = parser.parse(rows);

                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", `attachment; filename="clients_export.csv"`);
                return res.status(200).send(csv);
            }

            // excel
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "clients");
            const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename="clients_export.xlsx"`);
            return res.status(200).send(buf);
        } catch (e) {
            return next(e);
        }
    },
};
