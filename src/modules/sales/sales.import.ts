// src/modules/sales/sales.import.ts
//
// Bulk Billing Import — lets an owner/admin upload an Excel/CSV of historical
// billing records and generate real, correctly-dated `sales` rows from them.
// Modeled directly on products.import.ts (the existing, proven import
// pattern in this codebase): parse -> prefetch reference data once -> per-row
// validate+match -> create -> structured result. See that file for the
// pattern this one intentionally mirrors.
//
// The row-shape/parsing/allocation/matching primitives that don't need a
// database connection live in sales.import.logic.ts (unit tested there) —
// this file is the DB-backed orchestration around them.
//
// Things that are genuinely new here (not just copied from products/clients
// import) because billing data has no natural key of its own, and one row
// can describe more than one line item:
//   1. Duplicate-import protection is done at the *file* level
//      (sales_import_batches, keyed by salon_id + file hash) rather than by
//      inferring "this row looks like that row" from content — two real,
//      distinct bills can legitimately share the same date/client/amount.
//   2. Client/staff matching auto-creates on no match (client: phone/name +
//      normal onboarding fields; staff: name only, everything else left
//      genuinely null rather than fabricated) — see the Client/Staff blocks
//      below for why those two are treated differently. Client and staff
//      name matching are both normalized (trim + lowercase + collapsed
//      whitespace, normalizePersonName) and client phone matching uses
//      clientPhoneKey — the SAME key the create-time duplicate guard in
//      clients.repository.ts uses — specifically so a typo/spacing variant
//      of an existing name, or a "+91…" vs bare-10-digit spelling of an
//      existing number, reuses that record instead of silently creating a
//      duplicate. Both auto-create paths also seed the lookup maps in
//      dry_run as well as on commit, so the preview counts distinct people
//      rather than rows.
//   3. A Service/Product cell — and, positionally matched to it, the Staff
//      cell — can each list multiple items/names separated by commas
//      ("HAIR CUT LADIES, LOREAL SPA LADIES"). One Excel row is still
//      Amount is the financial source of truth: it's split across the
//      matched items in whole paise (no invented per-item pricing) so the
//      created invoice's total always matches the source row exactly.
import * as XLSX from "xlsx";
import csvParser from "csv-parser";
import { Readable } from "stream";
import crypto from "crypto";
import pool from "../../config/database";
import logger from "../../config/logger";
import { salesRepository } from "./sales.repository";
import { paymentsRepository } from "../payments/payments.repository";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import { tipCalculationService } from "../tips/tipCalculation.service";
import { stockLedgerService } from "../inventory/stock-ledger.service";
import { clientsService } from "../clients/clients.service";
import { CreateClientBody } from "../clients/clients.types";
import { clientPhoneKey } from "../clients/clients.phone";
import { staffRepository } from "../staff/staff.repository";
import { rolesRepository } from "../roles/roles.repository";
import { ensureDefaultRole } from "../roles/roles.service";
import { appointmentsService } from "../appointments/appointments.service";
import { appointmentsRepository } from "../appointments/appointments.repository";
import { PaymentMethod } from "./sales.types";
import {
    parseServiceItemNames,
    normalizePaymentMethod,
    allocateAmountPaise,
    matchCatalogItem,
    CatalogEntry,
    MISSING_STAFF_PLACEHOLDER_NAME,
} from "./sales.import.logic";

// ─── Row shape ────────────────────────────────────────────────────────────
interface ImportRow {
    date?: string;
    clientName?: string;
    clientPhone?: string;
    item?: string;           // Service/Product cell — may be comma-separated
    staffName?: string;      // may list multiple names, comma-separated — see the Staff block below
    amount?: number;
    discount?: number;
    tax?: number;
    paymentMethod?: string;
    notes?: string;
}

const COLUMN_ALIASES: Record<keyof ImportRow, string[]> = {
    date: ["date", "bill date", "invoice date"],
    clientName: ["client", "client name", "customer", "customer name"],
    clientPhone: ["client phone", "phone", "mobile", "contact", "client mobile"],
    item: ["service", "product", "service/product", "item", "item name"],
    // "staff code"/"staff id" accepted here too — a sheet built during this
    // feature's brief Staff-Code-only iteration may still carry that header
    // even though the cell values are (and always were meant to be) names.
    staffName: ["staff", "staff name", "employee", "staff code", "staff id"],
    amount: ["amount", "bill amount", "total amount", "total"],
    discount: ["discount", "discount amount"],
    tax: ["tax", "tax amount", "gst"],
    paymentMethod: ["payment method", "payment mode", "mode"],
    notes: ["notes", "remark", "remarks"],
};

const NUMBER_FIELDS = new Set<keyof ImportRow>(["amount", "discount", "tax"]);

// Header cells routinely carry more than the bare column name — the sample
// template itself marks required columns "Date *", "Client *", etc. — so
// matching against COLUMN_ALIASES on a plain lowercase+trim left every
// starred header one character off from its alias ("date *" !== "date"),
// which made row.date (and every other required field) resolve to
// undefined for 100% of rows. Stripping "*" and collapsing whitespace here
// is what actually makes "Date *"/"Client *"/"Staff *"/"Amount *" match.
function normalizeHeaderKey(h: string): string {
    return String(h ?? "")
        .toLowerCase()
        .replace(/\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildRow(get: (aliases: string[]) => any): ImportRow {
    const row: any = {};
    for (const key of Object.keys(COLUMN_ALIASES) as (keyof ImportRow)[]) {
        const raw = get(COLUMN_ALIASES[key]);
        if (key === "date") { row[key] = parseDateCell(raw); continue; }
        if (NUMBER_FIELDS.has(key)) {
            const str = raw == null ? "" : String(raw).trim();
            row[key] = str === "" ? undefined : parseFloat(str);
            continue;
        }
        const str = raw == null ? "" : String(raw).trim();
        row[key] = str === "" ? undefined : str;
    }
    return row as ImportRow;
}

const INVALID_DATE = "__invalid__";
// Excel-serial-day epoch: day 0 = 1899-12-30 (Excel's own, off-by-two-days
// "1900 leap year bug" included, matching how Excel/xlsx itself counts).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
function parseDateCell(value: any): string | undefined {
    if (value == null || value === "") return undefined;
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return INVALID_DATE;
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    // Raw Excel serial date — happens when a date-formatted cell's number
    // format isn't one `XLSX.read(..., { cellDates: true })` recognizes as a
    // date, so it comes back as the underlying number instead of a Date.
    // Sanity-bounded to roughly 1950-2150 (serials ~18300-91300) so a stray
    // numeric value that isn't actually a date (e.g. someone pastes an
    // amount into the Date column) reports as invalid rather than being
    // silently misread as some far-future/past date.
    if (typeof value === "number" && Number.isFinite(value) && value > 18300 && value < 91300) {
        const d = new Date(EXCEL_EPOCH_MS + value * 86400000);
        if (!isNaN(d.getTime())) {
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        }
    }
    const str = String(value).trim();
    if (!str) return undefined;
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return INVALID_DATE;
}

// Files exported by other software (not authored in Excel itself) sometimes
// declare a worksheet dimension/`!ref` that undercounts the real row count
// by one — the exporter's own row-count bookkeeping is off, not anything
// about the cell data. Excel itself ignores a wrong dimension hint when
// rendering (so the row is visibly there when a human opens the file), but
// `sheet_to_json` trusts `!ref` to know where to stop reading, and silently
// drops whatever real data sits just past it — one whole invoice vanishing
// from a 8,000+ row import with no error at all. Recomputing the true range
// from the worksheet's actual cell addresses (unioned with whatever was
// declared, so this can only grow the range, never shrink a correct one)
// makes an undercount impossible to hit.
function recomputeSheetRange(ws: XLSX.WorkSheet): void {
    const CELL_ADDR_RE = /^([A-Z]+)([0-9]+)$/;
    let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
    for (const key of Object.keys(ws)) {
        if (key[0] === "!") continue;
        const m = CELL_ADDR_RE.exec(key);
        if (!m) continue;
        const c = XLSX.utils.decode_col(m[1]);
        const r = Number(m[2]) - 1;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
    }
    if (maxR < 0) return; // no actual cells found — nothing to fix
    const declared = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
    ws["!ref"] = XLSX.utils.encode_range({
        s: { r: Math.min(minR, declared?.s.r ?? minR), c: Math.min(minC, declared?.s.c ?? minC) },
        e: { r: Math.max(maxR, declared?.e.r ?? maxR), c: Math.max(maxC, declared?.e.c ?? maxC) },
    });
}

// cellDates: true — makes XLSX hand back JS Date objects for date-formatted
// cells instead of raw serial numbers, so the `instanceof Date` branch in
// parseDateCell handles the common case directly; parseDateCell's own
// serial-number branch is the fallback for cells that aren't cleanly typed
// as dates. Read once and reused by both the real parse and the debug
// sample below, rather than re-reading the workbook twice.
function readExcelRawRows(buffer: Buffer): Record<string, any>[] {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    recomputeSheetRange(ws);
    return XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, any>[];
}

function parseExcelRows(raw: Record<string, any>[]): ImportRow[] {
    return raw.map((r) => {
        const lowered: Record<string, any> = {};
        for (const [k, v] of Object.entries(r)) lowered[normalizeHeaderKey(k)] = v;
        return buildRow((aliases) => {
            for (const a of aliases) if (lowered[a] != null && lowered[a] !== "") return lowered[a];
            return undefined;
        });
    });
}

async function parseCSV(buffer: Buffer): Promise<ImportRow[]> {
    return new Promise((resolve, reject) => {
        const results: ImportRow[] = [];
        Readable.from(buffer)
            .pipe(csvParser({ mapHeaders: ({ header }) => normalizeHeaderKey(header) }))
            .on("data", (r: Record<string, any>) => {
                results.push(buildRow((aliases) => {
                    for (const a of aliases) if (r[a] != null && r[a] !== "") return r[a];
                    return undefined;
                }));
            })
            .on("end", () => resolve(results))
            .on("error", reject);
    });
}

// ─── Result shape ───────────────────────────────────────────────────────────
interface ImportIssue {
    row: number;
    status: "failed" | "skipped";
    reason: string;
    suggestion?: string;
}

// One entry per source row, dry_run only — "source row, client, parsed
// items, matched Salonox items, staff, amount, discount, tax, payment
// method, and any errors", exactly as asked. Capped (PREVIEW_ROW_CAP) so a
// 7,000+ row file's dry-run response stays a reasonable size; the
// total/success/failed/skipped counts above still reflect every row
// regardless of the cap.
interface RowPreview {
    row: number;
    date?: string;
    client: { input: string | undefined; matched_name: string | null; will_create: boolean };
    staff: { input: string | undefined; matched_name: string | null; will_create: boolean };
    items: { input: string; matched_name: string | null; type: "service" | "product" | null }[];
    amount?: number;
    discount: number;
    tax: number;
    payment_method: string | null;
    status: "valid" | "failed";
    error?: string;
}

const PREVIEW_ROW_CAP = 500;

interface ImportResult {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    // Sum of (amount - discount) across every successful row — the actual
    // bill/sale value, excluding tax. Was previously folded into
    // total_billed together with tax, which made the "Bill Amount" card
    // display Bill Amount + GST as a single figure.
    total_bill_amount: number;
    // Sum of the Tax column across every successful row.
    total_tax_amount: number;
    // total_bill_amount + total_tax_amount — kept as its own field (not
    // derived client-side) so the three figures can never drift out of sync
    // with what was actually summed per row. This is "Total Sale".
    total_billed: number;
    // Clients/staff that didn't match an existing record and were created
    // automatically (name-only for staff — see the Staff block below). In a
    // dry_run these count what WOULD be created — nothing is actually
    // written until the real run.
    new_clients: number;
    new_staff: number;
    duplicate_batch: boolean;
    issues: ImportIssue[];
    preview?: RowPreview[];
    preview_truncated?: boolean;
}

export const salesImportService = {
    async importSales(params: {
        file: Buffer;
        filename: string;
        salonId: string;
        requesterUserId: string;
        dry_run: boolean;
    }): Promise<ImportResult> {
        const { file, filename, salonId, requesterUserId, dry_run } = params;

        const result: ImportResult = {
            total: 0, success: 0, failed: 0, skipped: 0,
            total_bill_amount: 0, total_tax_amount: 0, total_billed: 0,
            new_clients: 0, new_staff: 0, duplicate_batch: false, issues: [],
        };
        const previewRows: RowPreview[] = [];

        // ── Duplicate-file check (batch-level, not row-level — see file
        // header comment for why row-content hashing is the wrong tool here) ──
        const fileHash = crypto.createHash("sha256").update(file).digest("hex");
        const { rows: existingBatch } = await pool.query(
            `SELECT id FROM sales_import_batches WHERE salon_id = $1 AND file_hash = $2 LIMIT 1`,
            [salonId, fileHash]
        );
        if (existingBatch[0]) {
            result.duplicate_batch = true;
            if (!dry_run) {
                // Real run of a file already imported — refuse outright rather
                // than silently re-creating every invoice a second time.
                return result;
            }
            // dry_run: fall through so the preview can still show what the
            // file contains, with the warning surfaced via duplicate_batch.
        }

        // ── Parse ──────────────────────────────────────────────────────────
        const isExcel = filename.toLowerCase().endsWith(".xlsx") || filename.toLowerCase().endsWith(".xls");
        const rows = isExcel ? parseExcelRows(readExcelRawRows(file)) : await parseCSV(file);
        result.total = rows.length;
        if (rows.length === 0) return result;

        // Looked up (or created, if this salon has never had one before) once
        // per import, not per row — every staff member this import
        // auto-creates gets the salon's real default "Staff" role instead of
        // a bare role_id NULL, which otherwise showed as "No Role Assigned"
        // on the Staff page regardless of how many rows named that person.
        const defaultStaffRoleId = await ensureDefaultRole(salonId, "Staff");

        // ── Prefetch reference data once — same reasoning as
        // products.import.ts's own prefetch: per-row lookups on a
        // thousand-row sheet is slow enough to trip a gateway timeout. ──────
        const [clientRows, staffRows, serviceRows, productRows] = await Promise.all([
            pool.query(`SELECT id, full_name, phone_number FROM clients WHERE salon_id = $1`, [salonId]),
            pool.query(`SELECT id, first_name, last_name FROM staff WHERE salon_id = $1`, [salonId]),
            pool.query(`SELECT id, name FROM services WHERE salon_id = $1`, [salonId]),
            pool.query(`SELECT id, name FROM products WHERE salon_id = $1`, [salonId]),
        ]);

        // Collapses internal whitespace too (not just case + trim) — without
        // this, "Priya  Sharma" (stray double space, a common paste artifact
        // in real sheets) keyed differently than "Priya Sharma" and matched
        // nothing, so every mis-spaced repeat of an existing person's name
        // silently created a brand-new duplicate row instead of reusing the
        // real one. Mirrors the services/products name maps just below, which
        // already normalize this way. Shared by the client and staff maps —
        // the client map keyed on a bare `name.toLowerCase()` and so still had
        // the exact double-space hole the staff map was fixed for.
        function normalizePersonName(name: string): string {
            return name.trim().toLowerCase().replace(/\s+/g, " ");
        }

        const clientsByPhone = new Map<string, { id: string; name: string }[]>();
        const clientsByName = new Map<string, { id: string; name: string }[]>();
        for (const c of clientRows.rows) {
            const name = String(c.full_name ?? "").trim();
            // clientPhoneKey (clients.phone.ts) — the same key the create-time
            // duplicate guard uses, so a client already on file as
            // "+919876543210" matches a sheet cell of "9876543210" rather than
            // being created a second time under the same real number.
            const phoneKey = clientPhoneKey(c.phone_number);
            if (phoneKey) {
                const arr = clientsByPhone.get(phoneKey) ?? [];
                arr.push({ id: c.id, name }); clientsByPhone.set(phoneKey, arr);
            }
            if (name) {
                const key = normalizePersonName(name);
                const arr = clientsByName.get(key) ?? [];
                arr.push({ id: c.id, name }); clientsByName.set(key, arr);
            }
        }

        const staffByName = new Map<string, { id: string; name: string }[]>();
        for (const s of staffRows.rows) {
            const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
            const key = normalizePersonName(name);
            if (!key) continue;
            const arr = staffByName.get(key) ?? [];
            arr.push({ id: s.id, name }); staffByName.set(key, arr);
        }

        // matchCatalogItem (sales.import.logic.ts) expects normalizeItemName-
        // keyed maps of single entries — same normalization the matcher
        // itself applies to the input name, so keys agree on both sides.
        const servicesByName = new Map<string, CatalogEntry>();
        for (const s of serviceRows.rows) servicesByName.set(String(s.name).trim().toLowerCase().replace(/\s+/g, " "), { id: s.id, name: s.name });
        const productsByName = new Map<string, CatalogEntry>();
        for (const p of productRows.rows) productsByName.set(String(p.name).trim().toLowerCase().replace(/\s+/g, " "), { id: p.id, name: p.name });
        // Known sheet-side spelling -> canonical normalized catalog name.
        // Empty by default — extend as real alias needs come up from actual
        // sheets; deliberately not fuzzy-matched, so an unlisted variant
        // still fails loudly instead of guessing.
        const serviceAliasMap = new Map<string, string>();

        const importedSaleIds: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // +1 for 1-index, +1 for the header row

            const preview: RowPreview = {
                row: rowNum, date: row.date,
                client: { input: row.clientName, matched_name: null, will_create: false },
                staff: { input: row.staffName, matched_name: null, will_create: false },
                items: [],
                amount: row.amount, discount: row.discount ?? 0, tax: row.tax ?? 0,
                payment_method: row.paymentMethod ?? null,
                status: "failed",
            };
            const fail = (reason: string, suggestion?: string) => {
                result.failed++;
                result.issues.push({ row: rowNum, status: "failed", reason, suggestion });
                if (dry_run && previewRows.length < PREVIEW_ROW_CAP) {
                    preview.status = "failed"; preview.error = reason; previewRows.push(preview);
                }
            };

            try {
                // ── Date ──────────────────────────────────────────────────
                if (!row.date) { fail("Missing date", "Add a value in the Date column."); continue; }
                if (row.date === INVALID_DATE) { fail("Invalid date", "Use DD-MM-YYYY or YYYY-MM-DD."); continue; }

                // ── Client — match by phone, else by exact name, else
                // auto-create. Phone is checked first (a reliable key); if a
                // phone was given but didn't match anything on file, name is
                // still tried as a fallback before deciding this is a new
                // client, so a client who exists without that exact phone
                // recorded isn't duplicated. Client Phone itself is
                // mandatory on every row (not just for new clients) — a
                // bare name alone is too easy to accidentally split an
                // existing client into a duplicate record. ───────────────
                if (!row.clientPhone) {
                    fail("Client Phone is required", "Add the client's phone number in the Client Phone column.");
                    continue;
                }
                let matchedClient: { id: string; name: string } | undefined;
                const clientPhoneDigits = clientPhoneKey(row.clientPhone) || null;
                if (clientPhoneDigits) {
                    matchedClient = (clientsByPhone.get(clientPhoneDigits) ?? [])[0];
                }
                if (!matchedClient && row.clientName) {
                    const nameCandidates = clientsByName.get(normalizePersonName(row.clientName)) ?? [];
                    if (nameCandidates.length > 1) {
                        fail(`Multiple clients named "${row.clientName}" found`, "Add a Client Phone column to disambiguate.");
                        continue;
                    }
                    matchedClient = nameCandidates[0];
                }

                if (!matchedClient) {
                    if (!row.clientName) { fail("Client is required", "Add a value in the Client column."); continue; }
                    // Not on file under this phone or name — auto-create.
                    // dry_run never writes, so the preview simulates the
                    // outcome without an id that will ever be used (the
                    // dry_run branch further down returns before any DB
                    // write is reached).
                    if (dry_run) {
                        matchedClient = { id: "__dry_run_new_client__", name: row.clientName.trim() };
                        result.new_clients++;
                        preview.client.will_create = true;
                    } else {
                        try {
                            const parts = row.clientName.trim().split(/\s+/);
                            const firstName = parts[0];
                            const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
                            const createdClient = await clientsService.create({
                                first_name: firstName,
                                last_name: lastName,
                                // clientPhoneDigits is already clientPhoneKey-
                                // normalized, so what lands in the column is a
                                // bare local number — not the "+91…" the sheet
                                // may have carried, which would otherwise be
                                // stored alongside a "+91" country code too.
                                phone_country_code: clientPhoneDigits ? "+91" : null,
                                phone_number: clientPhoneDigits || null,
                            } as CreateClientBody, salonId);
                            matchedClient = { id: createdClient.id, name: (createdClient as any).full_name ?? row.clientName.trim() };
                            result.new_clients++;
                        } catch (createErr: any) {
                            fail(`Could not auto-create client "${row.clientName}": ${createErr?.message || "unknown error"}`);
                            continue;
                        }
                    }
                    // Cache immediately, on BOTH paths, so a later row in the
                    // same sheet referencing this same client (by phone or by
                    // name) reuses it. On the commit path that is what stops a
                    // second, duplicate client record being written. In dry_run
                    // it is what stops the preview counting one person once per
                    // bill — seeding only on the commit path is why a
                    // 12,000-row sheet covering 1,700 clients previewed as
                    // 12,000 "new clients".
                    clientsByName.set(normalizePersonName(row.clientName), [matchedClient!]);
                    if (clientPhoneDigits) clientsByPhone.set(clientPhoneDigits, [matchedClient!]);
                }
                preview.client.matched_name = matchedClient!.name;

                // ── Service / Product — one cell can list multiple items
                // separated by commas; one Excel row is still exactly one
                // invoice, just with multiple line items. Every item must
                // resolve independently or the whole row fails (no partial
                // invoices). Resolved before Staff so the Staff Code count
                // below has an item count to line up against. ─────────────
                if (!row.item) { fail("Service/Product is required", "Add a value in the Service column."); continue; }
                const itemNames = parseServiceItemNames(row.item);
                if (itemNames.length === 0) { fail("Service/Product is required", "Add a value in the Service column."); continue; }

                const matchedItems: { id: string; name: string; type: "service" | "product" }[] = [];
                const unmatchedNames: string[] = [];
                for (const name of itemNames) {
                    const match = matchCatalogItem(name, servicesByName, productsByName, serviceAliasMap);
                    if (match) matchedItems.push(match); else unmatchedNames.push(name);
                    preview.items.push({ input: name, matched_name: match?.name ?? null, type: match?.type ?? null });
                }
                if (unmatchedNames.length > 0) {
                    fail(
                        `Service/Product not found: ${unmatchedNames.map((n) => `"${n}"`).join(", ")}`,
                        "Check spelling against the salon's catalog, or add these to Salonox first."
                    );
                    continue;
                }

                // ── Staff — match by exact (normalized) name, else
                // auto-create with ONLY the name filled in; Salonox assigns
                // the new staff member's Staff Code automatically the same
                // way any other new staff member gets one (see
                // staffRepository.create). Unlike a real "Add Staff" (which
                // requires email/phone/gender/DOJ for login + onboarding),
                // this deliberately does NOT fabricate those — an
                // auto-created staff member here has every other field left
                // genuinely null, to be completed later, rather than seeded
                // with a fake email/phone that would look like real data.
                // A blank Staff cell is routed to a single, clearly-labeled
                // placeholder ("Unknown / Imported Staff") instead of either
                // failing the row or silently guessing a real staff member —
                // it goes through the exact same match-or-create path below,
                // so it's created once and reused for every such row.
                //
                // A bill with multiple line items can list multiple staff
                // names in the same cell, comma-separated, positionally
                // matched to the Service/Product items in the same order
                // (mirrors how that column itself is already comma-
                // separated) — one name per item, not one staff for the
                // whole invoice. A single name still applies to every item,
                // exactly as before.
                //
                // Matching is by name only, normalized (trim + lowercase +
                // collapsed whitespace — normalizePersonName above), which is
                // what actually prevents duplicates: a typo/spacing variant
                // of an existing staff member's name ("Priya  Sharma" vs
                // "Priya Sharma") now resolves to the SAME staff record
                // instead of silently creating a second one. ─────────────
                const staffNameInputs = row.staffName
                    ? row.staffName.split(",").map((n) => n.trim()).filter((n) => n.length > 0)
                    : [];
                if (staffNameInputs.length === 0) staffNameInputs.push(MISSING_STAFF_PLACEHOLDER_NAME);
                if (staffNameInputs.length !== 1 && staffNameInputs.length !== matchedItems.length) {
                    fail(
                        `${staffNameInputs.length} staff name(s) given for ${matchedItems.length} item(s)`,
                        "List either one staff name for the whole bill, or exactly one per Service/Product item in the same order."
                    );
                    continue;
                }

                const matchedStaffs: { id: string; name: string }[] = [];
                for (const staffNameInput of staffNameInputs) {
                    const staffKey = normalizePersonName(staffNameInput);
                    const staffCandidates = staffByName.get(staffKey) ?? [];
                    if (staffCandidates.length > 1) {
                        fail(`Multiple staff named "${staffNameInput}" found`, "Use each staff member's exact full name to disambiguate.");
                        matchedStaffs.length = 0;
                        break;
                    }
                    let matched: { id: string; name: string } | undefined = staffCandidates[0];

                    if (!matched) {
                        if (dry_run) {
                            matched = { id: "__dry_run_new_staff__", name: staffNameInput };
                            result.new_staff++;
                            preview.staff.will_create = true;
                        } else {
                            try {
                                const parts = staffNameInput.split(/\s+/);
                                const firstName = parts[0];
                                const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
                                // activateImmediately: true (4th arg) — this
                                // staff member was never "invited" (no email
                                // to invite), so leaving it to default
                                // (undefined here) marked invitation_status
                                // 'pending' as if a real invite were awaiting
                                // acceptance, with nothing behind it to ever
                                // accept. Explicit true keeps is_active true
                                // (already the case either way) and makes
                                // invitation_status 'accepted' instead —
                                // matching what this row actually is: a real,
                                // already-active staff member, just one with
                                // no login set up yet.
                                const createdStaff = await staffRepository.create(salonId, {
                                    first_name: firstName,
                                    last_name: lastName,
                                    email: undefined,
                                } as any, null, true);
                                // role_id has no column in the staff INSERT
                                // itself (see staffRepository.create) — every
                                // staff member's role is a separate
                                // assignment, same as the Roles & Permissions
                                // page's own "no role yet" self-heal path.
                                // Without this, an auto-created staff member
                                // showed "No Role Assigned" on the Staff page
                                // no matter how many bills named them.
                                await rolesRepository.assignStaffRole(createdStaff.id, defaultStaffRoleId);
                                matched = {
                                    id: createdStaff.id,
                                    name: `${createdStaff.first_name} ${createdStaff.last_name ?? ""}`.trim(),
                                };
                                result.new_staff++;
                            } catch (createErr: any) {
                                fail(`Could not auto-create staff "${staffNameInput}": ${createErr?.message || "unknown error"}`);
                                matchedStaffs.length = 0;
                                break;
                            }
                        }
                        // Cache on both paths so a later row in the same sheet
                        // referencing this same staff member (including the
                        // missing-staff placeholder) reuses it: on the commit
                        // path that's what stops a duplicate staff row, and in
                        // dry_run it's what stops the preview counting one
                        // person once per bill (same defect the client cache
                        // above had).
                        staffByName.set(staffKey, [matched!]);
                    }
                    matchedStaffs.push(matched);
                }
                if (matchedStaffs.length !== staffNameInputs.length) continue; // a fail() above already recorded the reason

                // One name for a multi-item bill means "this staff did all
                // of it" — expand to line up 1:1 with matchedItems, same as
                // a single name always has.
                const staffPerItem = matchedStaffs.length === 1
                    ? matchedItems.map(() => matchedStaffs[0])
                    : matchedStaffs;
                const matchedStaff = matchedStaffs[0]; // primary/billing staff for the invoice-level fields below
                preview.staff.matched_name = matchedStaffs.map((s) => s.name).join(", ");

                // ── Amount ────────────────────────────────────────────────
                // 0 is a legitimate historical bill amount (a comped/free
                // service, a goodwill visit, etc.) — only missing, non-
                // numeric, or negative values are rejected. row.amount is a
                // real `number` here (buildRow's NUMBER_FIELDS parsing
                // already turns a blank cell into `undefined`, never `0`),
                // so `=== undefined` correctly excludes only true "nothing
                // was in this cell" cases, not an entered zero.
                if (row.amount === undefined || isNaN(row.amount) || row.amount < 0) {
                    fail("Missing or invalid amount", "Add a value (0 or greater) in the Amount column.");
                    continue;
                }
                const discount = row.discount && row.discount > 0 ? row.discount : 0;
                const tax = row.tax && row.tax > 0 ? row.tax : 0;

                // ── Payment method ────────────────────────────────────────
                let paymentMethod: PaymentMethod = "cash";
                if (row.paymentMethod) {
                    const resolved = normalizePaymentMethod(row.paymentMethod);
                    if (!resolved) {
                        fail(`Invalid Payment Method "${row.paymentMethod}"`, "Use one of: Cash, Card, UPI (incl. Gpay/Google Pay/PhonePe/Paytm/BHIM), Split, Gift Card, Wallet.");
                        continue;
                    }
                    paymentMethod = resolved;
                }

                // The sheet's Amount column is the row's TAX-INCLUSIVE final
                // total (confirmed against real Salonist export data: source
                // "Total Value" == this Amount column, with Tax already
                // embedded in it) — NOT a pre-tax figure to add tax onto.
                // Getting this backwards was the previous bug: it added Tax
                // on top of an already-tax-inclusive Amount, silently
                // double-counting tax in every created invoice's total, not
                // just in the summary cards.
                //   Total Sale  = Amount - Discount              (matches source "Total Value")
                //   Bill Amount = Total Sale - Tax                (net of tax — the true bill amount)
                //   Subtotal for line items = Amount - Tax        (pre-tax, pre-discount base; see below)
                const totalSale = Math.round((row.amount - discount) * 100) / 100;
                const billAmount = Math.round((totalSale - tax) * 100) / 100;

                if (dry_run) {
                    result.success++;
                    result.total_bill_amount += billAmount;
                    result.total_tax_amount += tax;
                    result.total_billed += totalSale;
                    preview.status = "valid";
                    if (previewRows.length < PREVIEW_ROW_CAP) previewRows.push(preview);
                    continue;
                }

                // ── Split the row's amount across the matched items in whole
                // paise — never inventing an individual item price, just
                // guaranteeing the resulting totals match the source row
                // exactly (see sales.import.logic.ts's allocateAmountPaise
                // doc comment). Two DIFFERENT targets, deliberately:
                //   - Sale line items (saleItemsInput) sum to Amount - Tax —
                //     salesRepository.create()'s own total formula is
                //     `subtotal - discount + tax`, so pre-tax items here plus
                //     the top-level discount/tax below reconstructs exactly
                //     Total Sale (Amount - Discount), while sales.tax_amount
                //     still correctly records the real historical Tax instead
                //     of silently reporting 0 (it would if tax had already
                //     been baked into the items and then added again here).
                //   - Appointment line items (below) sum to Total Sale
                //     directly, since the appointment is created with
                //     include_gst:false (no tax computed on its own side) —
                //     its own grand total must equal Total Sale/sales.total_amount
                //     for the Payment Collection / Appointment Detail reports
                //     that key off it to agree with the sale, not the pre-tax base. ──
                const subtotalForItems = Math.round((row.amount - tax) * 100) / 100;
                const itemPaise = allocateAmountPaise(Math.round(subtotalForItems * 100), matchedItems.length);
                const saleItemsInput = matchedItems.map((it, idx) => ({
                    item_type: it.type,
                    item_id: it.id,
                    staff_id: staffPerItem[idx].id,
                    name: it.name,
                    quantity: 1,
                    unit_price: (itemPaise[idx] / 100).toFixed(2),
                    discount_amount: "0",
                    tax_amount: "0",
                    taxable_amount: (itemPaise[idx] / 100).toFixed(2),
                }));
                const appointmentPaise = allocateAmountPaise(Math.round(totalSale * 100), matchedItems.length);

                // ── Create a real Appointment first ──────────────────────
                // Payment Collection Report and Detailed Appointment Report
                // are both keyed off `appointments` (the former INNER JOINs
                // payments to it, the latter explodes its services/
                // product_items JSONB for line items) — a Sale/Payment pair
                // with appointment_id = null is invisible to both. So each
                // imported bill row gets its own backdated, already-"paid"
                // appointment, and the Sale + Payment below are linked to it.
                // DURATION_MINUTES_DEFAULT: the sheet has no per-row duration,
                // and none of the reports this unlocks (payment collection,
                // appointment detail) filter or display on it — an arbitrary
                // fixed value is fine; only scheduled_at (the date) matters.
                const DURATION_MINUTES_DEFAULT = 30;
                const scheduledAt = `${row.date}T00:00:00.000Z`;
                const itemsWithShares = matchedItems.map((it, idx) => ({
                    ...it,
                    price: Number((appointmentPaise[idx] / 100).toFixed(2)),
                    staff: staffPerItem[idx],
                }));
                const appointmentServices = itemsWithShares
                    .filter((it) => it.type === "service")
                    .map((it) => ({
                        service_id: it.id,
                        staff_id: it.staff.id,
                        staff_name: it.staff.name,
                        name: it.name,
                        price: it.price,
                        quantity: 1,
                    }));
                const appointmentProducts = itemsWithShares
                    .filter((it) => it.type === "product")
                    .map((it) => ({
                        product_id: it.id,
                        staff_id: it.staff.id,
                        staff_name: it.staff.name,
                        name: it.name,
                        price: it.price,
                        quantity: 1,
                    }));

                const appointment = await appointmentsService.create({
                    requesterUserId,
                    body: {
                        salon_id: salonId,
                        client_id: matchedClient!.id,
                        staff_id: matchedStaff!.id,
                        scheduled_at: scheduledAt,
                        duration_minutes: DURATION_MINUTES_DEFAULT,
                        status: "paid",
                        source: "quick_sale",
                        notes: row.notes || undefined,
                        services: appointmentServices,
                        product_items: appointmentProducts,
                        include_gst: false,
                    },
                });
                // scheduled_at above sets the appointment's visit date, but
                // "Booked Date" in the Appointment Detail Report reads
                // appointments.created_at, which the INSERT always stamps as
                // NOW() — backdate it to match, same as the sale/payment below.
                await pool.query(`UPDATE appointments SET created_at = $2 WHERE id = $1`, [appointment.id, row.date]);

                // ── Create the sale + payment record ─────────────────────
                // Reuses salesRepository.create() as-is (same transactional,
                // race-safe invoice numbering every live checkout gets) with
                // status "completed" and this row's own date as created_at —
                // parseCreatedAt() (sales.repository.ts) already accepts a
                // plain "YYYY-MM-DD" and treats it as that day, midnight UTC.
                // A failure here is caught by the row-level try/catch below
                // (fail() marks the row failed, no invoice is left behind) —
                // but the appointment just created above would otherwise be
                // orphaned (no linked sale/payment), so it's cleaned up too;
                // see the file header's "no partial invoices" rule.
                let sale;
                try {
                    sale = await salesRepository.create({
                        salon_id: salonId,
                        client_id: matchedClient!.id,
                        appointment_id: appointment.id,
                        staff_id: matchedStaff!.id,
                        status: "completed",
                        discount_amount: discount.toString(),
                        tax_amount: tax.toString(),
                        payment_method: paymentMethod,
                        notes: row.notes || undefined,
                        created_at: row.date,
                        items: saleItemsInput,
                    }, requesterUserId);
                } catch (saleErr) {
                    await appointmentsRepository.deleteById(appointment.id).catch(() => {});
                    throw saleErr;
                }

                // Mirrors salesService.checkout()'s side-effect chain for a
                // fully-paid bill — payment record, commission, stock, tip —
                // deliberately WITHOUT the WhatsApp receipt / notification
                // sends a live checkout fires, since those don't make sense
                // for a historical backfill.
                try {
                    await paymentsRepository.create({
                        salon_id: salonId,
                        client_id: matchedClient!.id,
                        appointment_id: appointment.id,
                        gross_amount: row.amount,
                        discount_amount: discount,
                        net_amount: totalSale,
                        paid_amount: totalSale,
                        due_amount: 0,
                        payment_method: paymentMethod,
                        status: "completed",
                        notes: `Bulk billing import — Sale ID: ${sale.id}`,
                    });
                    // paymentsRepository.create() always stamps paid_at/created_at
                    // as NOW() — both reports' date logic (Payment Collection's
                    // payment_date, Appointment Detail's payment_method lookup
                    // via "latest payment") key off this row, so it must carry
                    // the historical date too. Mirrors salesRepository's own
                    // appointment_id-scoped backdate of payments (see
                    // updateDateForAppointment's UTC-conversion comment there
                    // for why this can't just bind the Date directly).
                    await pool.query(
                        `UPDATE payments SET created_at = ($2::timestamptz AT TIME ZONE 'UTC'), paid_at = ($2::timestamptz AT TIME ZONE 'UTC') WHERE appointment_id = $1`,
                        [appointment.id, row.date]
                    );
                } catch (payErr: any) {
                    logger.error("[sales/import] payment record creation failed:", { saleId: sale.id, error: payErr?.message ?? payErr });
                }

                const items = await salesRepository.findItemsBySaleId(sale.id);
                commissionCalculationService.calculateForSale({
                    salonId, saleId: sale.id, appointmentId: appointment.id,
                    fallbackStaffId: matchedStaff!.id, items,
                }).catch(() => {});
                tipCalculationService.earnForSale(sale.id, salonId).catch(() => {});
                stockLedgerService.deductForSale({
                    salonId, branchId: null, saleId: sale.id,
                    invoiceNumber: sale.invoice_number, createdBy: requesterUserId,
                    items: items.map((it) => ({ item_type: it.item_type, item_id: it.item_id, quantity: Number(it.quantity) || 0 })),
                }).catch(() => {});

                importedSaleIds.push(sale.id);
                result.success++;
                result.total_bill_amount += billAmount;
                result.total_tax_amount += tax;
                result.total_billed += totalSale;
            } catch (err: any) {
                fail(err?.message || "Unexpected error");
                logger.error("[sales/import] row processing failed:", { row: rowNum, error: err?.message ?? err });
            }
        }

        if (dry_run) {
            result.preview = previewRows;
            result.preview_truncated = result.total > PREVIEW_ROW_CAP;
        }

        // ── Record the batch + tag every created sale with it ────────────
        if (!dry_run && importedSaleIds.length > 0) {
            const { rows: batchRows } = await pool.query(
                `INSERT INTO sales_import_batches
                    (salon_id, filename, file_hash, uploaded_by, total_rows, success_count, failed_count, skipped_count, total_billed)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [salonId, filename, fileHash, requesterUserId, result.total, result.success, result.failed, result.skipped, result.total_billed]
            );
            await pool.query(
                `UPDATE sales SET import_batch_id = $1 WHERE id = ANY($2::uuid[])`,
                [batchRows[0].id, importedSaleIds]
            );
        }

        return result;
    },
};
