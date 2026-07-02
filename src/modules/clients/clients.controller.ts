// src/modules/clients/clients.controller.ts
import { NextFunction, Request, Response } from "express";
import csvParser from "csv-parser";
import { Readable } from "stream";
import * as XLSX from "xlsx";
import { Parser as Json2CsvParser } from "json2csv";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { clientsService } from "./clients.service";
import { clientsRepository } from "./clients.repository";
import { ClientsListQuery, CreateClientBody, UpdateClientBody } from "./clients.types";
import pool from "../../config/database";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

const isValidUUID = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

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
            const salonId = getSalonId(req);
            const parsePosInt = (v: unknown): number | undefined => {
                const n = Number(String(v ?? ""));
                return Number.isInteger(n) && n >= 1 ? n : undefined;
            };
            const page    = req.query.page     !== undefined ? parsePosInt(req.query.page)     : undefined;
            const rawSize = req.query.pageSize  !== undefined ? parsePosInt(req.query.pageSize) : undefined;
            const rawLim  = req.query.limit     !== undefined ? parsePosInt(req.query.limit)    : undefined;
            const resolvedLimit  = Math.min(rawSize ?? rawLim ?? 20, 200);
            const resolvedOffset = Math.max(
                0,
                page !== undefined
                    ? (page - 1) * resolvedLimit
                    : req.query.offset !== undefined
                        ? (parsePosInt(req.query.offset) ?? 0)
                        : 0,
            );
            const q: ClientsListQuery = {
                offset: resolvedOffset,
                limit: resolvedLimit,
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
            const raw = await clientsService.list(q, salonId);
            const currentPage = page ?? Math.max(1, Math.floor(resolvedOffset / resolvedLimit) + 1);
            const data = {
                ...raw,
                page: currentPage,
                pageSize: resolvedLimit,
                totalPages: Math.ceil(raw.total / resolvedLimit),
                totalRecords: raw.total,
            };
            return sendSuccess(res, 200, data, "Clients fetched successfully");
        } catch (e) { return next(e); }
    },

    // POST /api/v1/clients
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const body = req.body as CreateClientBody;
            const created = await clientsService.create(body, salonId);
            return sendSuccess(res, 201, created, "Client created successfully");
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/:clientId
    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");
            if (!isValidUUID(clientId)) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");
            const include = req.query.include ? String(req.query.include) : "";
            const data = await clientsService.getById(clientId, salonId, include);
            return sendSuccess(res, 200, data, "Client fetched successfully");
        } catch (e) { return next(e); }
    },

    // PATCH /api/v1/clients/:clientId
    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");
            if (!isValidUUID(clientId)) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");
            const patch = req.body as UpdateClientBody;
            const updated = await clientsService.update(clientId, patch, salonId);
            return sendSuccess(res, 200, updated, "Client updated successfully");
        } catch (e) { return next(e); }
    },

    // DELETE /api/v1/clients/:clientId
    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");
            if (!isValidUUID(clientId)) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");
            const hard = String(req.query.hard || "").toLowerCase() === "true";
            await clientsService.remove(clientId, salonId, hard);
            return sendSuccess(res, 200, {}, hard ? "Client deleted successfully" : "Client archived successfully");
        } catch (e) { return next(e); }
    },

    // POST /api/v1/clients/import
    async import(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file) throw new AppError(400, "file is required", "VALIDATION_ERROR");
            const file_type = req.body.file_type ? String(req.body.file_type) : undefined;
            const mode = (req.body.mode ? String(req.body.mode) : "upsert") as "create_only" | "upsert";
            const dry_run = String(req.body.dry_run || "").toLowerCase() === "true";
            const name = file.originalname.toLowerCase();
            let rows: any[] = [];
            if (file_type === "excel" || name.endsWith(".xlsx") || name.endsWith(".xls")) rows = parseExcelBuffer(file.buffer);
            else rows = await parseCSVBuffer(file.buffer);
            const result = await clientsService.importClients({ rows, mode, dry_run, salonId });
            return sendSuccess(res, 200, result, "Import completed");
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/duplicates
    async findDuplicates(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const phone_number = req.query.phone_number ? String(req.query.phone_number).trim() : "";
            if (!phone_number) throw new AppError(400, "phone_number query param is required", "VALIDATION_ERROR");
            const duplicates = await clientsService.findDuplicatesByPhone(phone_number, salonId);
            return sendSuccess(res, 200, duplicates, "Duplicates fetched successfully");
        } catch (e) { return next(e); }
    },

    // POST /api/v1/clients/merge
    async merge(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const result = await clientsService.mergeClients(req.body, salonId);
            return sendSuccess(res, 200, result, "Clients merged successfully");
        } catch (e) { return next(e); }
    },

    // POST /api/v1/clients/merge-duplicates
    async mergeAllDuplicates(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const result = await clientsService.mergeAllDuplicates(salonId);
            return sendSuccess(
                res, 200, result,
                result.total_groups === 0
                    ? "No duplicate clients found"
                    : `Merged ${result.total_merged} duplicate groups, archived ${result.total_archived} clients`
            );
        } catch (e) { return next(e); }
    },

    // POST /api/v1/clients/block
    async block(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const { client_ids, reason } = req.body;
            await clientsService.blockClients(client_ids, reason, salonId);
            return sendSuccess(res, 200, {}, "Clients blocked");
        } catch (e) { return next(e); }
    },

    // POST /api/v1/clients/unblock
    async unblock(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const { client_ids } = req.body;
            await clientsService.unblockClients(client_ids, salonId);
            return sendSuccess(res, 200, {}, "Clients unblocked");
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/export
    async export(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const format = String(req.query.format || "").toLowerCase();
            if (!["csv", "excel"].includes(format)) throw new AppError(400, "format must be csv or excel", "VALIDATION_ERROR");
            const q: ClientsListQuery = {
                offset: req.query.offset !== undefined ? Number(String(req.query.offset)) : 0,
                limit: req.query.limit !== undefined ? Math.min(Number(String(req.query.limit)), 2000) : 200,
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
            const data = await clientsService.list(q, salonId);
            const rows = data.items.map((c: any) => ({
                id: c.id, first_name: c.first_name, last_name: c.last_name, full_name: c.full_name,
                email: c.email, phone_country_code: c.phone_country_code, phone_number: c.phone_number,
                additional_email: c.additional_email, additional_phone_country_code: c.additional_phone_country_code,
                additional_phone_number: c.additional_phone_number, birthday_day_month: c.birthday_day_month,
                birthday_year: c.birthday_year, gender: c.gender, pronouns: c.pronouns,
                client_source: c.client_source, referred_by_client_id: c.referred_by_client_id,
                preferred_language: c.preferred_language, occupation: c.occupation, country: c.country,
                avatar_url: c.avatar_url, total_sales: c.total_sales, reviews_avg: c.reviews_avg,
                reviews_count: c.reviews_count, is_active: c.is_active, block_reason: c.block_reason,
                email_notifications: c.email_notifications, sms_notifications: c.sms_notifications,
                whatsapp_notifications: c.whatsapp_notifications, email_marketing: c.email_marketing,
                sms_marketing: c.sms_marketing, whatsapp_marketing: c.whatsapp_marketing,
                created_at: c.created_at, updated_at: c.updated_at,
            }));
            if (format === "csv") {
                const parser = new Json2CsvParser({ withBOM: true });
                const csv = parser.parse(rows);
                res.setHeader("Content-Type", "text/csv");
                res.setHeader("Content-Disposition", `attachment; filename="clients_export.csv"`);
                return res.status(200).send(csv);
            }
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "clients");
            const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            res.setHeader("Content-Disposition", `attachment; filename="clients_export.xlsx"`);
            return res.status(200).send(buf);
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/search
    async search(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const q = String(req.query.q || "").trim();
            const limit = req.query.limit !== undefined ? Number(String(req.query.limit)) : 20;
            const clients = await clientsService.search(q, salonId, limit);
            const results = clients.map((c: any) => ({
                id: c.id,
                first_name: c.first_name,
                last_name: c.last_name ?? "",
                phone_number: c.phone_number ?? null,
                email: c.email ?? null,
                avatar_url: c.avatar_url ?? null,
            }));
            return sendSuccess(res, 200, results, "Search results");
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/filter — Smart Filter for campaigns
    async filterForCampaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const {
                birth_month, birth_day_month, gender,
                service_category_id, preview,
                client_source, joined_from, joined_to,
            } = req.query;

            const genders = gender
                ? (gender as string).split(",").map((g: string) => g.trim()).filter(Boolean)
                : undefined;

            const filters = {
                birth_month:         birth_month ? parseInt(birth_month as string) : undefined,
                birth_day_month:     birth_day_month as string | undefined,
                genders,
                service_category_id: service_category_id as string | undefined,
                client_source:       client_source as string | undefined,
                joined_from:         joined_from as string | undefined,
                joined_to:           joined_to as string | undefined,
            };

            if (preview === "true") {
                const total = await clientsRepository.countFilterForCampaign(salonId, filters);
                return sendSuccess(res, 200, { total }, "Filter count fetched successfully");
            }

            const clients = await clientsRepository.filterForCampaign(salonId, filters);
            return sendSuccess(res, 200, { clients, total: clients.length }, "Filtered clients fetched successfully");
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/with-history-stats
    // Returns paginated clients with server-side search, gender, last_visit,
    // service, and staff filtering. Used by the Client History page.
    async listWithHistoryStats(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId   = getSalonId(req);
            const serviceId = String(req.query.service_id || "").trim();
            const staffId   = String(req.query.staff_id   || "").trim();
            const search    = String(req.query.search     || "").trim();
            const gender    = String(req.query.gender     || "").trim();
            const lastVisit = String(req.query.last_visit || "").trim();
            const page      = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
            const limit     = 50;
            const offset    = (page - 1) * limit;

            // Whitelist gender and lastVisit to prevent injection in SQL fragments
            const validGenders    = new Set(["", "all", "male", "female", "other"]);
            const validLastVisits = new Set(["", "all", "7", "30", "90", "90plus"]);
            if (!validGenders.has(gender))       throw new AppError(400, "Invalid gender",     "VALIDATION_ERROR");
            if (!validLastVisits.has(lastVisit)) throw new AppError(400, "Invalid last_visit", "VALIDATION_ERROR");

            // Gender SQL fragment — whitelisted, safe to interpolate
            let genderCond = "";
            if (gender === "male" || gender === "female") {
                genderCond = `AND LOWER(COALESCE(c.gender, '')) = '${gender}'`;
            } else if (gender === "other") {
                genderCond = `AND (c.gender IS NULL OR LOWER(c.gender) NOT IN ('male', 'female'))`;
            }

            // Last-visit SQL fragment — whitelisted, safe to interpolate
            let lastVisitCond = "";
            if      (lastVisit === "7")      lastVisitCond = `AND ad.last_visit_at >= NOW() - INTERVAL '7 days'`;
            else if (lastVisit === "30")     lastVisitCond = `AND ad.last_visit_at >= NOW() - INTERVAL '30 days'`;
            else if (lastVisit === "90")     lastVisitCond = `AND ad.last_visit_at >= NOW() - INTERVAL '90 days'`;
            else if (lastVisit === "90plus") lastVisitCond = `AND (ad.last_visit_at IS NULL OR ad.last_visit_at < NOW() - INTERVAL '90 days')`;

            // $1 = salonId  $2 = search pattern  $3 = serviceId  $4 = staffId
            const params = [salonId, search ? `%${search}%` : "", serviceId, staffId];

            const CTE = `
                WITH appt_data AS (
                    SELECT
                        a.client_id,
                        MAX(a.scheduled_at) FILTER (WHERE a.status = 'completed') AS last_visit_at,
                        ARRAY_AGG(DISTINCT s_item->>'service_id')
                            FILTER (WHERE s_item->>'service_id' IS NOT NULL) AS service_ids,
                        ARRAY_AGG(DISTINCT s_item->>'staff_id')
                            FILTER (WHERE s_item->>'staff_id'   IS NOT NULL) AS staff_ids
                    FROM appointments a
                    LEFT JOIN LATERAL jsonb_array_elements(
                        COALESCE(a.services, '[]'::jsonb)
                    ) s_item ON true
                    WHERE a.salon_id = $1
                    GROUP BY a.client_id
                )`;

            const WHERE = `
                WHERE c.salon_id = $1
                  AND ($2 = '' OR (c.full_name ILIKE $2 OR c.phone_number ILIKE $2 OR c.email ILIKE $2))
                  AND ($3 = '' OR $3 = ANY(COALESCE(ad.service_ids, '{}'::text[])))
                  AND ($4 = '' OR $4 = ANY(COALESCE(ad.staff_ids,   '{}'::text[])))
                  ${genderCond}
                  ${lastVisitCond}`;

            const [countRes, dataRes] = await Promise.all([
                pool.query(
                    `${CTE}
                     SELECT COUNT(*)::int AS total
                     FROM clients c
                     LEFT JOIN appt_data ad ON ad.client_id = c.id
                     ${WHERE}`,
                    params
                ),
                pool.query(
                    `${CTE}
                     SELECT
                         c.id, c.first_name, c.last_name, c.full_name,
                         c.email, c.phone_number, c.phone_country_code,
                         c.gender, c.is_active, c.total_sales, c.created_at,
                         ad.last_visit_at,
                         COALESCE(ad.service_ids, '{}') AS service_ids,
                         COALESCE(ad.staff_ids,   '{}') AS staff_ids
                     FROM clients c
                     LEFT JOIN appt_data ad ON ad.client_id = c.id
                     ${WHERE}
                     ORDER BY c.created_at DESC
                     LIMIT ${limit} OFFSET ${offset}`,
                    params
                ),
            ]);

            const total   = countRes.rows[0]?.total ?? 0;
            const items   = dataRes.rows;
            const hasMore = offset + items.length < total;

            return sendSuccess(res, 200, { items, total, page, limit, hasMore }, "Clients with history stats fetched");
        } catch (e) { return next(e); }
    },

    // GET /api/v1/clients/:clientId/history
    async getHistory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const clientId = String(req.params.clientId || "").trim();
            if (!clientId) throw new AppError(400, "clientId is required", "VALIDATION_ERROR");
            if (!isValidUUID(clientId)) throw new AppError(400, "Invalid clientId format", "VALIDATION_ERROR");

            const client = await clientsRepository.findById(clientId, salonId);
            if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

            const [apptRes, salesRes, pkgRes, statsRes, totalSpendRes] = await Promise.all([

                // 1. Appointments
                pool.query(
                    `SELECT
                        a.id,
                        a.scheduled_at,
                        a.status,
                        a.duration_minutes,
                        a.notes,
                        a.cancel_reason,
                        a.services,
                        a.product_items,
                        a.staff_id,
                        COALESCE(
                            (SELECT SUM(p.net_amount)
                             FROM payments p
                             WHERE p.appointment_id = a.id
                               AND p.status IN ('completed', 'partial')),
                            0
                        ) AS amount_paid,
                        COALESCE(
                            (SELECT CASE
                                WHEN bool_or(p.status = 'completed') THEN 'paid'
                                WHEN bool_or(p.status = 'partial')   THEN 'partial'
                                ELSE 'unpaid'
                            END
                            FROM payments p WHERE p.appointment_id = a.id),
                            'unpaid'
                        ) AS payment_status
                     FROM appointments a
                     WHERE a.client_id = $1 AND a.salon_id = $2
                     ORDER BY a.scheduled_at DESC
                     LIMIT 200`,
                    [clientId, salonId]
                ),

                // 2. Sales with line items
                pool.query(
                    `SELECT
                        s.id,
                        s.invoice_number,
                        s.status,
                        s.subtotal,
                        s.discount_amount,
                        s.tip_amount,
                        s.tax_amount,
                        s.total_amount,
                        s.payment_method,
                        s.notes,
                        s.created_at,
                        s.appointment_id,
                        json_agg(
                            json_build_object(
                                'name',        si.name,
                                'item_type',   si.item_type,
                                'quantity',    si.quantity,
                                'unit_price',  si.unit_price,
                                'total_price', si.total_price
                            ) ORDER BY si.created_at ASC
                        ) FILTER (WHERE si.id IS NOT NULL) AS items
                     FROM sales s
                     LEFT JOIN sale_items si ON si.sale_id = s.id
                     WHERE s.client_id = $1 AND s.salon_id = $2
                     GROUP BY s.id
                     ORDER BY s.created_at DESC
                     LIMIT 200`,
                    [clientId, salonId]
                ),

                // 3. Packages
                pool.query(
                    `SELECT
                        cp.id,
                        cp.package_name,
                        cp.status,
                        cp.total_amount,
                        cp.paid_amount,
                        cp.pending_amount,
                        cp.payment_status,
                        cp.expiry_date,
                        cp.created_date,
                        COALESCE(
                            json_agg(
                                json_build_object(
                                    'service_name',       cps.service_name,
                                    'total_sessions',     cps.total_sessions,
                                    'completed_sessions', cps.completed_sessions
                                )
                            ) FILTER (WHERE cps.id IS NOT NULL),
                            '[]'
                        ) AS services
                     FROM client_packages cp
                     LEFT JOIN client_package_services cps ON cps.client_package_id = cp.id
                     WHERE cp.client_id = $1 AND cp.salon_id = $2
                     GROUP BY cp.id
                     ORDER BY cp.created_date DESC
                     LIMIT 50`,
                    [clientId, salonId]
                ),

                // 4. Appointment stats
                pool.query(
                    `SELECT
                        COUNT(*)::int                                               AS total_appointments,
                        COUNT(*) FILTER (WHERE status = 'completed')::int          AS completed_appointments,
                        COUNT(*) FILTER (WHERE status = 'no_show')::int            AS no_shows,
                        COUNT(*) FILTER (WHERE status = 'cancelled')::int          AS cancellations
                     FROM appointments
                     WHERE client_id = $1 AND salon_id = $2`,
                    [clientId, salonId]
                ),

                // 5. Lifetime spend — sum actual paid_amount from payments (covers both
                //    draft sales and completed sales since a payment record is always
                //    created when money is collected, regardless of sale status)
                pool.query(
                    `SELECT COALESCE(SUM(paid_amount), 0) AS lifetime_spend
                     FROM payments
                     WHERE client_id = $1 AND salon_id = $2 AND status IN ('completed', 'partial')`,
                    [clientId, salonId]
                ),
            ]);

            const pkgRows = pkgRes.rows;

            const data = {
                client: {
                    id:                 client.id,
                    first_name:         client.first_name,
                    last_name:          client.last_name,
                    full_name:          client.full_name,
                    email:              client.email,
                    phone_number:       client.phone_number,
                    phone_country_code: client.phone_country_code,
                    avatar_url:         client.avatar_url,
                    is_active:          client.is_active,
                    created_at:         client.created_at,
                },
                stats: {
                    total_appointments:     statsRes.rows[0]?.total_appointments     ?? 0,
                    completed_appointments: statsRes.rows[0]?.completed_appointments ?? 0,
                    no_shows:               statsRes.rows[0]?.no_shows               ?? 0,
                    cancellations:          statsRes.rows[0]?.cancellations           ?? 0,
                    lifetime_spend:         Number(totalSpendRes.rows[0]?.lifetime_spend ?? 0),
                    total_sales:            salesRes.rowCount ?? 0,
                    active_packages:        pkgRows.filter((p: any) => p.status === "active").length,
                    // Most recent completed visit; fall back to any appointment date
                    last_visit_at:          apptRes.rows.find((a: any) => a.status === "completed")?.scheduled_at
                                              ?? apptRes.rows[0]?.scheduled_at
                                              ?? null,
                },
                appointments: apptRes.rows,
                sales:        salesRes.rows,
                packages:     pkgRows,
            };

            return sendSuccess(res, 200, data, "Client history fetched successfully");
        } catch (e) { return next(e); }
    },
};