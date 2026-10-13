import type { PoolClient } from "pg";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { branchesService } from "../branches/branches.service";
import { assetsRepository as repo } from "./assets.repository";
import {
  ASSET_CONDITIONS, ASSET_STATUSES, INCIDENT_TYPES, INVESTIGATION_STATUSES,
  type Actor, type Asset, type AssetCondition, type AssetListFilters, type IncidentType, type InvestigationStatus,
} from "./assets.types";

const bad = (message: string) => new AppError(400, message, "VALIDATION_ERROR");
const str = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw bad(`Value too long (max ${max} characters)`);
  return s;
};
const cond = (v: unknown, field = "condition"): AssetCondition => {
  if (!ASSET_CONDITIONS.includes(v as AssetCondition)) throw bad(`${field} must be one of: ${ASSET_CONDITIONS.join(", ")}`);
  return v as AssetCondition;
};
// Tool-logo id from the frontend catalog (e.g. "hair-dryer"): lowercase letters, digits, dashes only.
const iconId = (v: unknown): string | null => {
  const s = str(v, 40);
  if (s && !/^[a-z0-9-]+$/.test(s)) throw bad("Invalid icon");
  return s;
};
const when = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw bad(`${field} is not a valid date/time`);
  return d.toISOString();
};

// asset_categories comes from Migration/create_tool_tracking.sql; say so instead of a bare 500 when it has not been run.
async function withCategoriesTable<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e?.code === "42P01") throw new AppError(503, "Categories are not set up on this database yet - run Migration/create_tool_tracking.sql", "MIGRATION_PENDING");
    throw e;
  }
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    // A column added by a later version of Migration/create_tool_tracking.sql (icon, receipt_url,
    // warranty_card_url) is missing: say what to run instead of a bare 500.
    if (e?.code === "42703" || e?.code === "42P01") {
      throw new AppError(503, "Tool Tracking database is out of date - run Migration/create_tool_tracking.sql", "MIGRATION_PENDING");
    }
    throw e;
  } finally {
    client.release();
  }
}

// Locks the asset row for the rest of the transaction — this is what stops two people
// issuing / returning the same asset at the same instant.
async function lockAsset(c: PoolClient, id: string, salonId: string): Promise<Asset> {
  const a = await repo.findById(id, salonId, c, true);
  if (!a) throw new AppError(404, "Asset not found", "NOT_FOUND");
  return a;
}

export const assetsService = {
  list: (salonId: string, f: AssetListFilters) => repo.list(salonId, f),
  categories: (salonId: string) => repo.categories(salonId),
  async deleteCategory(actor: Actor, nameRaw: unknown) {
    const name = str(nameRaw, 80);
    if (!name) throw bad("Category name is required");
    const used = await repo.assetsUsingCategory(actor.salonId, name);
    if (used > 0) {
      throw new AppError(409, `"${name}" is used by ${used} asset${used === 1 ? "" : "s"} - change those assets first`, "CATEGORY_IN_USE");
    }
    await withCategoriesTable(() => repo.deleteCategory(actor.salonId, name));
    return repo.categories(actor.salonId);
  },
  async addCategory(actor: Actor, body: Record<string, any>) {
    const name = str(body.name, 80);
    if (!name) throw bad("Category name is required");
    if (!(await withCategoriesTable(() => repo.addCategory(actor.salonId, name, actor.userId)))) {
      throw new AppError(409, `Category "${name}" already exists`, "CATEGORY_EXISTS");
    }
    return repo.categories(actor.salonId);
  },
  history: async (salonId: string, id: string) => {
    if (!(await repo.findById(id, salonId))) throw new AppError(404, "Asset not found", "NOT_FOUND");
    return repo.history(id, salonId);
  },
  listIncidents: (salonId: string, f: { status?: InvestigationStatus; asset_id?: string; open_only?: boolean }) => repo.listIncidents(salonId, f),

  async get(salonId: string, id: string) {
    const a = await repo.findById(id, salonId);
    if (!a) throw new AppError(404, "Asset not found", "NOT_FOUND");
    return a;
  },

  async create(actor: Actor, b: Record<string, any>) {
    const name = str(b.name, 150);
    if (!name) throw bad("Asset name is required");
    if (!str(b.category, 80)) throw bad("Category is required");
    const condition = b.condition ? cond(b.condition) : "good";
    if (condition === "damaged") throw bad("A new asset cannot be registered as damaged");

    let branchId: string | null = str(b.branch_id, 40);
    if (branchId) {
      if (!(await repo.branchBelongsToSalon(branchId, actor.salonId))) throw bad("Branch not found for this salon");
    } else {
      const branches = await branchesService.listBranchesBySalon(actor.salonId);
      branchId = (branches.find((x) => x.is_main) ?? branches[0])?.id ?? null;
    }
    const userName = await repo.userName(actor.userId);

    return inTx(async (c) => {
      const seq = await repo.nextSeq(c, actor.salonId);
      const asset = await repo.insert(c, {
        salonId: actor.salonId, branchId, seq, code: `AST-${String(seq).padStart(5, "0")}`, name,
        category: str(b.category, 80), brand: str(b.brand, 80), model: str(b.model, 80),
        serial: str(b.serial_number, 120), photoUrl: str(b.photo_url, 1000), icon: iconId(b.icon),
        receiptUrl: str(b.receipt_url, 1000), warrantyUrl: str(b.warranty_card_url, 1000), condition, notes: str(b.notes, 2000),
        userId: actor.userId,
      });
      await repo.addEvent(c, {
        salonId: actor.salonId, assetId: asset.id, type: "registered", branchId, condition, statusAfter: "available",
        notes: asset.notes, userId: actor.userId, userName,
      });
      return asset;
    });
  },

  async update(actor: Actor, id: string, b: Record<string, any>) {
    const userName = await repo.userName(actor.userId);
    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (a.status === "retired") throw new AppError(409, "A retired asset can no longer be edited", "ASSET_RETIRED");

      const patch: Record<string, any> = {};
      if ("name" in b) { const v = str(b.name, 150); if (!v) throw bad("Asset name is required"); patch.name = v; }
      for (const [key, max] of [["category", 80], ["brand", 80], ["model", 80], ["serial_number", 120], ["photo_url", 1000], ["receipt_url", 1000], ["warranty_card_url", 1000], ["notes", 2000]] as const) {
        if (key in b) patch[key] = str(b[key], max);
      }
      if ("icon" in b) patch.icon = iconId(b.icon);
      if ("category" in b && !patch.category) throw bad("Category is required");

      let transferTo: string | null = null;
      if ("branch_id" in b && b.branch_id && b.branch_id !== a.branch_id) {
        if (a.status === "issued") throw new AppError(409, "Return the asset before moving it to another branch", "ASSET_ISSUED");
        if (!(await repo.branchBelongsToSalon(String(b.branch_id), actor.salonId, c))) throw bad("Branch not found for this salon");
        transferTo = String(b.branch_id);
        patch.branch_id = transferTo;
      }

      let newCondition: AssetCondition | null = null;
      if ("condition" in b && b.condition !== a.condition) {
        newCondition = cond(b.condition);
        patch.condition = newCondition;
        if (newCondition === "damaged") patch.needs_inspection = true;
      }

      if (!Object.keys(patch).length) return a;
      const updated = await repo.update(c, id, actor.salonId, patch);

      await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "updated", branchId: updated.branch_id, notes: "Details edited", userId: actor.userId, userName });
      if (transferTo) {
        await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "transferred", branchId: transferTo, fromBranchId: a.branch_id, userId: actor.userId, userName });
      }
      if (newCondition) {
        await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "condition_changed", condition: newCondition, fromCondition: a.condition, userId: actor.userId, userName });
      }
      return updated;
    });
  },

  // ── Issue ─────────────────────────────────────────────────────────────────
  async issue(actor: Actor, id: string, b: Record<string, any>) {
    const staffId = str(b.staff_id, 40);
    if (!staffId) throw bad("Select a staff member");
    const staff = await repo.findStaff(staffId, actor.salonId);
    if (!staff) throw bad("Staff member not found");
    if (!staff.is_active) throw bad("This staff member is inactive");
    const occurredAt = when(b.issued_at, "Issue date/time");
    const expected = when(b.expected_return_at, "Expected return");
    if (expected && new Date(expected) <= new Date(occurredAt ?? Date.now())) throw bad("Expected return must be after the issue time");
    const userName = await repo.userName(actor.userId);

    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (a.status !== "available") {
        const why: Record<string, string> = {
          issued: "This asset is already issued",
          missing: "This asset is reported missing",
          retired: "This asset is retired",
          under_maintenance: "This asset is under maintenance",
        };
        throw new AppError(409, why[a.status] ?? "This asset is not available", "ASSET_NOT_AVAILABLE");
      }
      if (a.needs_inspection) {
        throw new AppError(409, "This asset was returned damaged and must be inspected and cleared before it can be issued again", "ASSET_NEEDS_INSPECTION");
      }
      const condition = b.condition ? cond(b.condition) : a.condition;
      if (condition === "damaged") throw bad("A damaged asset cannot be issued");

      const updated = await repo.update(c, id, actor.salonId, {
        status: "issued", current_staff_id: staffId, issued_at: occurredAt ?? new Date().toISOString(),
        expected_return_at: expected, condition,
      });
      await repo.addEvent(c, {
        salonId: actor.salonId, assetId: id, type: "issued", staffId, branchId: a.branch_id, condition, fromCondition: a.condition,
        statusAfter: "issued", expectedReturnAt: expected, notes: str(b.notes, 2000), occurredAt, userId: actor.userId, userName,
      });
      return updated;
    });
  },

  // ── Return ────────────────────────────────────────────────────────────────
  async returnAsset(actor: Actor, id: string, b: Record<string, any>) {
    const condition = cond(b.condition, "Returned condition");
    const occurredAt = when(b.returned_at, "Return date/time");
    const notes = str(b.notes, 2000);
    const userName = await repo.userName(actor.userId);

    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (a.status !== "issued" || !a.current_staff_id) throw new AppError(409, "This asset is not currently issued", "ASSET_NOT_ISSUED");
      const damaged = condition === "damaged";

      const updated = await repo.update(c, id, actor.salonId, {
        status: "available", current_staff_id: null, issued_at: null, expected_return_at: null, condition,
        needs_inspection: damaged ? true : a.needs_inspection,
      });
      await repo.addEvent(c, {
        salonId: actor.salonId, assetId: id, type: "returned", staffId: a.current_staff_id, branchId: a.branch_id, condition,
        fromCondition: a.condition, statusAfter: "available", notes, occurredAt, userId: actor.userId, userName,
      });

      // A damaged return opens an incident so it lands in the investigation list. It records the
      // last custodian as a fact for the owner to look at — never as a conclusion about fault.
      if (damaged) {
        const inc = await repo.insertIncident(c, {
          salonId: actor.salonId, assetId: id, type: "damaged", reportedAt: occurredAt, lastStaffId: a.current_staff_id,
          lastCondition: a.condition, description: notes ? `Returned damaged: ${notes}` : "Returned damaged", photoUrl: null, userId: actor.userId,
        });
        await repo.addEvent(c, {
          salonId: actor.salonId, assetId: id, type: "damage_reported", staffId: a.current_staff_id, incidentId: inc.id,
          condition, fromCondition: a.condition, notes: "Flagged for inspection on return", occurredAt, userId: actor.userId, userName,
        });
      }
      return updated;
    });
  },

  // ── Damage / missing ──────────────────────────────────────────────────────
  async reportIncident(actor: Actor, id: string, b: Record<string, any>) {
    if (!INCIDENT_TYPES.includes(b.incident_type)) throw bad("incident_type must be 'damaged' or 'missing'");
    const type = b.incident_type as IncidentType;
    const description = str(b.description, 4000);
    if (!description) throw bad("Please describe what happened");
    const occurredAt = when(b.reported_at, "Reported date/time");
    const userName = await repo.userName(actor.userId);

    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (a.status === "retired") throw new AppError(409, "This asset is retired", "ASSET_RETIRED");
      if (type === "missing" && a.status === "missing") throw new AppError(409, "This asset is already reported missing", "ALREADY_REPORTED");
      if (type === "damaged" && (await repo.openIncidentCount(id, "damaged", c)) > 0) {
        throw new AppError(409, "An open damage report already exists for this asset", "ALREADY_REPORTED");
      }

      const inc = await repo.insertIncident(c, {
        salonId: actor.salonId, assetId: id, type, reportedAt: occurredAt, lastStaffId: a.current_staff_id,
        lastCondition: a.condition, description, photoUrl: str(b.photo_url, 1000), userId: actor.userId,
      });

      // Last RECORDED custodian only when the asset is still out. If it was already returned,
      // the history (not this field) is where the owner investigates — we never guess a culprit.
      const patch: Record<string, any> = type === "damaged"
        ? { condition: "damaged", needs_inspection: true }
        : { status: "missing", current_staff_id: null, issued_at: null, expected_return_at: null };
      await repo.update(c, id, actor.salonId, patch);

      await repo.addEvent(c, {
        salonId: actor.salonId, assetId: id, type: type === "damaged" ? "damage_reported" : "missing_reported", staffId: a.current_staff_id,
        branchId: a.branch_id, condition: type === "damaged" ? "damaged" : a.condition, fromCondition: a.condition,
        statusAfter: type === "missing" ? "missing" : a.status, incidentId: inc.id, notes: description, occurredAt, userId: actor.userId, userName,
      });
      return inc;
    });
  },

  async updateIncident(actor: Actor, incidentId: string, b: Record<string, any>) {
    if (!INVESTIGATION_STATUSES.includes(b.investigation_status)) throw bad(`investigation_status must be one of: ${INVESTIGATION_STATUSES.join(", ")}`);
    const status = b.investigation_status as InvestigationStatus;
    const notes = str(b.resolution_notes, 4000);
    const found = b.outcome === "found";
    const resolving = status === "resolved" || status === "closed";
    if (resolving && !notes) throw bad("Add resolution notes before closing an investigation");
    const userName = await repo.userName(actor.userId);

    return inTx(async (c) => {
      const inc = await repo.findIncident(incidentId, actor.salonId, c, true);
      if (!inc) throw new AppError(404, "Incident not found", "NOT_FOUND");
      const updated = await repo.updateIncident(c, incidentId, { status, notes, userId: actor.userId, resolved: resolving });

      if (found && inc.incident_type === "missing") {
        const a = await lockAsset(c, inc.asset_id, actor.salonId);
        if (a.status === "missing") {
          await repo.update(c, a.id, actor.salonId, { status: "available" });
          await repo.addEvent(c, { salonId: actor.salonId, assetId: a.id, type: "found", branchId: a.branch_id, statusAfter: "available", incidentId, notes, userId: actor.userId, userName });
        }
      }
      await repo.addEvent(c, {
        salonId: actor.salonId, assetId: inc.asset_id, type: "incident_updated", incidentId, notes: `Investigation: ${status}${notes ? ` — ${notes}` : ""}`,
        userId: actor.userId, userName,
      });
      return updated;
    });
  },

  // Owner has inspected a damaged asset: set its real condition and let it be issued again.
  async clearInspection(actor: Actor, id: string, b: Record<string, any>) {
    const condition = cond(b.condition);
    if (condition === "damaged") throw bad("Choose the condition the asset is in after inspection (not damaged)");
    const userName = await repo.userName(actor.userId);
    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (!a.needs_inspection) throw new AppError(409, "This asset is not waiting for inspection", "NOT_FLAGGED");
      const updated = await repo.update(c, id, actor.salonId, { needs_inspection: false, condition });
      const notes = str(b.notes, 2000);
      await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "inspection_cleared", condition, fromCondition: a.condition, notes, userId: actor.userId, userName });
      const closed = await repo.resolveOpenDamage(c, id, actor.userId, `Inspected and cleared (${condition})${notes ? ` - ${notes}` : ""}`);
      if (closed > 0) {
        await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "incident_updated", notes: `Damage report resolved - inspection cleared`, userId: actor.userId, userName });
      }
      return updated;
    });
  },

  // ── Maintenance / retire ──────────────────────────────────────────────────
  async maintenance(actor: Actor, id: string, b: Record<string, any>) {
    if (b.action !== "start" && b.action !== "complete") throw bad("action must be 'start' or 'complete'");
    const notes = str(b.notes, 2000);
    const userName = await repo.userName(actor.userId);
    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (b.action === "start") {
        if (a.status !== "available") throw new AppError(409, "Only an available asset can be sent for maintenance", "ASSET_NOT_AVAILABLE");
        const updated = await repo.update(c, id, actor.salonId, { status: "under_maintenance" });
        await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "maintenance_started", branchId: a.branch_id, statusAfter: "under_maintenance", notes, userId: actor.userId, userName });
        return updated;
      }
      if (a.status !== "under_maintenance") throw new AppError(409, "This asset is not under maintenance", "NOT_IN_MAINTENANCE");
      const condition = cond(b.condition, "Condition after repair");
      if (condition === "damaged") throw bad("Choose the condition after repair (not damaged)");
      const updated = await repo.update(c, id, actor.salonId, { status: "available", condition, needs_inspection: false });
      await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "maintenance_completed", branchId: a.branch_id, condition, fromCondition: a.condition, statusAfter: "available", notes, userId: actor.userId, userName });
      return updated;
    });
  },

  async retire(actor: Actor, id: string, b: Record<string, any>) {
    const userName = await repo.userName(actor.userId);
    return inTx(async (c) => {
      const a = await lockAsset(c, id, actor.salonId);
      if (a.status === "retired") throw new AppError(409, "This asset is already retired", "ASSET_RETIRED");
      if (a.status === "issued") throw new AppError(409, "Return the asset before retiring it", "ASSET_ISSUED");
      const updated = await repo.update(c, id, actor.salonId, { status: "retired" });
      await repo.addEvent(c, { salonId: actor.salonId, assetId: id, type: "retired", branchId: a.branch_id, statusAfter: "retired", notes: str(b.notes, 2000), userId: actor.userId, userName });
      return updated;
    });
  },

  statuses: ASSET_STATUSES,
};
