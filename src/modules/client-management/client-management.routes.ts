import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { developerLogins, updateDeveloper } from "./developer-logins";
import { developerActivity } from "./developer-activity";
import {
  clientManagementRepository as repo,
  MEETING_TYPES, MEETING_MODES, MEETING_STATUSES, TRAINING_STATUSES, UNDERSTANDING, ACTIVITY_TYPES, TASK_STATUSES, TASK_PRIORITIES, ATTACHMENT_ENTITIES,
} from "./client-management.repository";

// Mounted in super-admin.routes.ts at /client-management, behind authMiddleware + superAdminMiddleware, so everything here is
// Super Admin only. Team members are chosen from the existing `developers` directory; no login is involved.
const router = Router();
type Authed = Request & { user?: { userId: string } };

// The form no longer asks for a title; a meeting without one is named after its type.
const MEETING_TYPE_LABELS: Record<string, string> = {
  client_meeting: "Client Meeting", product_training: "Product Training", technical_support: "Technical Support", on_site_visit: "On-site Visit",
  online_meeting: "Online Meeting", phone_discussion: "Phone Discussion", implementation: "Implementation", follow_up: "Follow-up",
};
const bad = (message: string) => new AppError(400, message, "VALIDATION_ERROR");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (v: unknown, max = 4000): string | null => { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; };
const reqText = (v: unknown, label: string, max = 4000): string => { const s = text(v, max); if (!s) throw bad(`${label} is required`); return s; };
const uuid = (v: unknown, label: string): string => { const s = String(v ?? "").trim(); if (!UUID.test(s)) throw bad(`${label} is invalid`); return s; };
const optUuid = (v: unknown, label: string): string | null => (v === undefined || v === null || v === "" ? null : uuid(v, label));
const date = (v: unknown, label: string): string => { const s = String(v ?? "").trim(); if (!DATE.test(s) || isNaN(Date.parse(s))) throw bad(`${label} must be a date (YYYY-MM-DD)`); return s; };
const optDate = (v: unknown, label: string): string | null => (v === undefined || v === null || v === "" ? null : date(v, label));
const optTime = (v: unknown, label: string): string | null => { if (v === undefined || v === null || v === "") return null; const s = String(v).trim(); if (!TIME.test(s)) throw bad(`${label} must be a time (HH:MM)`); return s; };
const oneOf = <T extends string>(v: unknown, list: readonly T[], label: string): T => { if (!list.includes(v as T)) throw bad(`${label} must be one of: ${list.join(", ")}`); return v as T; };
const optOneOf = <T extends string>(v: unknown, list: readonly T[], label: string): T | null => (v === undefined || v === null || v === "" ? null : oneOf(v, list, label));
const names = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? "").split(/[,\n]/)).map((s) => String(s).trim().slice(0, 160)).filter(Boolean).slice(0, 50);
const num = (v: unknown, d: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(v)) || d));
const page = (r: Request) => ({ page: num(r.query.page, 1, 1, 100000), limit: num(r.query.limit, 20, 1, 100) });
const qs = (v: unknown) => { const s = String(v ?? "").trim(); return s || undefined; };
const qEnum = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);
const qUuid = (v: unknown) => (UUID.test(String(v ?? "")) ? String(v) : undefined);
const qUuids = (v: unknown) => { const out = String(v ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s)); return out.length ? out : undefined; };
const qEnums = <T extends string>(v: unknown, list: readonly T[]) => { const out = String(v ?? "").split(",").map((s) => s.trim()).filter((s) => list.includes(s as T)) as T[]; return out.length ? out : undefined; };
const qDate = (v: unknown) => (DATE.test(String(v ?? "")) ? String(v) : undefined);
const me = (r: Authed) => { if (!r.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED"); return r.user.userId; };
const wrap = (fn: (req: Authed, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req as Authed, res).catch(next); };

async function checkRefs(salonId: string, developerId: string | null) {
  if (!(await repo.salonExists(salonId))) throw new AppError(404, "Salon not found", "NOT_FOUND");
  if (developerId && !(await repo.developerExists(developerId))) throw new AppError(404, "Team member not found", "NOT_FOUND");
}


// ── Developer / team-member Super Admin logins ──────────────────────────────
// Optional: a developer from the team directory can be given a Super Admin login (their email + a password shown once here).
router.patch("/team/:id", wrap(async (req, res) => sendSuccess(res, 200, await updateDeveloper(uuid(req.params.id, "Developer"), req.body ?? {}), "Developer updated")));
router.get("/developer-activity/summary", wrap(async (req, res) => sendSuccess(res, 200, await developerActivity.summary({ from: qDate(req.query.from), to: qDate(req.query.to) }), "Developer summary fetched")));
router.get("/developer-activity", wrap(async (req, res) => sendSuccess(res, 200, await developerActivity.feed({
  developerIds: qUuids(req.query.developer_id), entityTypes: qEnums(req.query.entity_type, ATTACHMENT_ENTITIES), from: qDate(req.query.from), to: qDate(req.query.to), search: qs(req.query.search), ...page(req),
}), "Developer activity fetched")));
router.get("/developer-logins", wrap(async (_req, res) => sendSuccess(res, 200, await developerLogins.list(), "Developer logins fetched")));
router.post("/team/:id/login", wrap(async (req, res) => sendSuccess(res, 201, await developerLogins.create(uuid(req.params.id, "Developer"), req.body?.password), "Login created")));
router.post("/team/:id/login/reset-password", wrap(async (req, res) => sendSuccess(res, 200, await developerLogins.resetPassword(uuid(req.params.id, "Developer"), req.body?.password), "Password reset")));
router.patch("/team/:id/login", wrap(async (req, res) => {
  if (typeof req.body?.is_active !== "boolean") throw bad("is_active must be true or false");
  return sendSuccess(res, 200, await developerLogins.setActive(uuid(req.params.id, "Developer"), req.body.is_active), "Login updated");
}));
// ── Dashboard + salon summary ────────────────────────────────────────────────
router.get("/dashboard", wrap(async (_req, res) => sendSuccess(res, 200, await repo.dashboard(), "Dashboard fetched")));

router.get("/salons/:salonId/summary", wrap(async (req, res) => {
  const salonId = uuid(req.params.salonId, "Salon");
  if (!(await repo.salonExists(salonId))) throw new AppError(404, "Salon not found", "NOT_FOUND");
  return sendSuccess(res, 200, await repo.salonSummary(salonId), "Summary fetched");
}));

// ── Meetings ─────────────────────────────────────────────────────────────────
router.get("/meetings", wrap(async (req, res) => {
  const data = await repo.listMeetings({
    salonId: qUuids(req.query.salon_id), developerId: qUuids(req.query.developer_id), type: qEnums(req.query.type, MEETING_TYPES),
    status: qEnums(req.query.status, MEETING_STATUSES), from: qDate(req.query.from), to: qDate(req.query.to), search: qs(req.query.search), ...page(req),
  });
  return sendSuccess(res, 200, data, "Meetings fetched");
}));

router.get("/meetings/:id", wrap(async (req, res) => {
  const m = await repo.getMeeting(uuid(req.params.id, "Meeting"));
  if (!m) throw new AppError(404, "Meeting not found", "NOT_FOUND");
  return sendSuccess(res, 200, m, "Meeting fetched");
}));

function meetingTimes(start: string | null, end: string | null, label: string) {
  if (start && end && end <= start) throw bad(`${label}: end time must be after the start time`);
}

router.post("/meetings", wrap(async (req, res) => {
  const b = req.body ?? {};
  const input = {
    salon_id: uuid(b.salon_id, "Salon"), developer_id: optUuid(b.developer_id, "Team member"),
    title: text(b.title, 200) ?? MEETING_TYPE_LABELS[String(b.meeting_type)] ?? "Meeting", meeting_type: oneOf(b.meeting_type, MEETING_TYPES, "Meeting type"),
    meeting_date: date(b.meeting_date, "Meeting date"), start_time: optTime(b.start_time, "Start time"), end_time: optTime(b.end_time, "End time"),
    meeting_mode: oneOf(b.meeting_mode, MEETING_MODES, "Meeting mode"), location_or_link: text(b.location_or_link, 1000),
    attendees: names(b.attendees), purpose: text(b.purpose), agenda: text(b.agenda), internal_notes: text(b.internal_notes),
  };
  meetingTimes(input.start_time, input.end_time, "Meeting");
  await checkRefs(input.salon_id, input.developer_id);
  const id = await repo.createMeeting(input, me(req));
  return sendSuccess(res, 201, await repo.getMeeting(id), "Meeting scheduled");
}));

router.patch("/meetings/:id", wrap(async (req, res) => {
  const id = uuid(req.params.id, "Meeting");
  const b = req.body ?? {};
  const patch: Record<string, any> = {};
  if ("developer_id" in b) patch.developer_id = optUuid(b.developer_id, "Team member");
  if ("title" in b) patch.title = reqText(b.title, "Meeting title", 200);
  if ("meeting_type" in b) patch.meeting_type = oneOf(b.meeting_type, MEETING_TYPES, "Meeting type");
  if ("meeting_date" in b) patch.meeting_date = date(b.meeting_date, "Meeting date");
  if ("start_time" in b) patch.start_time = optTime(b.start_time, "Start time");
  if ("end_time" in b) patch.end_time = optTime(b.end_time, "End time");
  if ("meeting_mode" in b) patch.meeting_mode = oneOf(b.meeting_mode, MEETING_MODES, "Meeting mode");
  for (const k of ["location_or_link", "purpose", "agenda", "internal_notes"]) if (k in b) patch[k] = text(b[k], k === "location_or_link" ? 1000 : 4000);
  if ("attendees" in b) patch.attendees = names(b.attendees);
  if ("status" in b) {
    if (b.status === "completed") throw bad("Use Mark as Completed to complete a meeting, so its completion details are recorded");
    patch.status = oneOf(b.status, MEETING_STATUSES, "Status");
  }
  meetingTimes(patch.start_time ?? null, patch.end_time ?? null, "Meeting");
  if (patch.developer_id && !(await repo.developerExists(patch.developer_id))) throw new AppError(404, "Team member not found", "NOT_FOUND");
  const r = await repo.updateMeeting(id, patch, me(req));
  if ("error" in r) {
    if (r.error === "NOT_FOUND") throw new AppError(404, "Meeting not found", "NOT_FOUND");
    throw new AppError(409, "A completed meeting is part of the history and can't be edited", "MEETING_COMPLETED");
  }
  return sendSuccess(res, 200, await repo.getMeeting(id), "Meeting updated");
}));

router.post("/meetings/:id/complete", wrap(async (req, res) => {
  const id = uuid(req.params.id, "Meeting");
  const b = req.body ?? {};
  const input = {
    actual_date: date(b.actual_date, "Actual meeting date"),
    actual_start_time: optTime(b.actual_start_time, "Actual start time"), actual_end_time: optTime(b.actual_end_time, "Actual end time"),
    attendees_present: names(b.attendees_present), discussion_summary: reqText(b.discussion_summary, "Discussion summary"),
    training_provided: text(b.training_provided), work_completed: text(b.work_completed), client_feedback: text(b.client_feedback),
    issues_discussed: text(b.issues_discussed), pending_actions: text(b.pending_actions), next_followup_date: optDate(b.next_followup_date, "Next follow-up date"),
  };
  if (!input.actual_start_time || !input.actual_end_time) throw bad("Actual start and end time are required to complete a meeting");
  meetingTimes(input.actual_start_time, input.actual_end_time, "Actual");
  if (input.attendees_present.length === 0) throw bad("Record who was present (Attendees Present)");
  if (input.actual_date > new Date().toISOString().slice(0, 10)) throw bad("A meeting can't be completed on a future date");
  const r = await repo.completeMeeting(id, input, me(req));
  if ("error" in r) {
    if (r.error === "NOT_FOUND") throw new AppError(404, "Meeting not found", "NOT_FOUND");
    throw new AppError(409, r.error === "CANCELLED" ? "A cancelled meeting can't be completed" : "This meeting is already completed", "MEETING_STATE");
  }
  return sendSuccess(res, 200, await repo.getMeeting(id), "Meeting marked as completed");
}));

// ── Training ─────────────────────────────────────────────────────────────────
router.get("/training/modules", wrap(async (_req, res) => sendSuccess(res, 200, await repo.listModules(), "Modules fetched")));

router.post("/training/modules", wrap(async (req, res) => {
  const name = reqText(req.body?.name, "Module name", 160);
  const created = await repo.createModule(name, me(req));
  if (!created) throw new AppError(409, "A training module with this name already exists", "DUPLICATE");
  return sendSuccess(res, 201, created, "Module added");
}));

router.get("/training/overview", wrap(async (req, res) => sendSuccess(res, 200, await repo.trainingOverview({ search: qs(req.query.search), ...page(req) }), "Training overview fetched")));

router.get("/training/salons/:salonId", wrap(async (req, res) => {
  const salonId = uuid(req.params.salonId, "Salon");
  if (!(await repo.salonExists(salonId))) throw new AppError(404, "Salon not found", "NOT_FOUND");
  return sendSuccess(res, 200, await repo.salonTraining(salonId, { status: qEnum(req.query.status, TRAINING_STATUSES), developerId: qUuid(req.query.developer_id) }), "Training fetched");
}));

// One row per salon + module, so POST and PUT both create-or-update it (POST answers 201 when the row is new).
const saveTraining = wrap(async (req, res) => {
  const b = req.body ?? {};
  const input = {
    salon_id: uuid(b.salon_id, "Salon"), module_id: uuid(b.module_id, "Training module"), developer_id: optUuid(b.developer_id, "Team member"),
    training_date: optDate(b.training_date, "Training date"), status: oneOf(b.status, TRAINING_STATUSES, "Training status"),
    notes: text(b.notes), attending_staff: text(b.attending_staff, 1000),
    duration_minutes: b.duration_minutes === undefined || b.duration_minutes === null || b.duration_minutes === "" ? null : num(b.duration_minutes, 0, 0, 24 * 60),
    client_understanding: optOneOf(b.client_understanding, UNDERSTANDING, "Client understanding"), client_feedback: text(b.client_feedback),
    next_training_date: optDate(b.next_training_date, "Next training date"),
  };
  if (input.status === "scheduled" && !input.training_date) throw bad("Pick the training date to schedule it");
  await checkRefs(input.salon_id, input.developer_id);
  const { id, created } = await repo.upsertTraining(input, me(req));
  return sendSuccess(res, req.method === "POST" && created ? 201 : 200, { id }, created ? "Training added" : "Training updated");
});
router.post("/training/progress", saveTraining);
router.put("/training/progress", saveTraining);

// ── Activity timeline ────────────────────────────────────────────────────────
router.get("/activities", wrap(async (req, res) => sendSuccess(res, 200, await repo.listActivities({
  salonId: qUuids(req.query.salon_id), type: qEnums(req.query.type, ACTIVITY_TYPES), developerId: qUuids(req.query.developer_id),
  from: qDate(req.query.from), to: qDate(req.query.to), search: qs(req.query.search), ...page(req),
}), "Activities fetched")));

router.post("/activities", wrap(async (req, res) => {
  const b = req.body ?? {};
  const input = {
    salon_id: uuid(b.salon_id, "Salon"), developer_id: optUuid(b.developer_id, "Team member"), activity_type: oneOf(b.activity_type, ACTIVITY_TYPES, "Activity type"),
    activity_date: b.activity_date ? date(String(b.activity_date).slice(0, 10), "Activity date") : new Date().toISOString().slice(0, 10),
    description: reqText(b.description, "Activity description"), work_completed: text(b.work_completed), pending_work: text(b.pending_work),
    next_followup: optDate(b.next_followup, "Next follow-up"),
  };
  await checkRefs(input.salon_id, input.developer_id);
  const id = await repo.createActivity(input, me(req));
  return sendSuccess(res, 201, { id }, "Activity added");
}));

router.patch("/activities/:id", wrap(async (req, res) => {
  const b = req.body ?? {};
  const patch: Record<string, any> = {};
  if ("developer_id" in b) patch.developer_id = optUuid(b.developer_id, "Team member");
  if ("activity_type" in b) patch.activity_type = oneOf(b.activity_type, ACTIVITY_TYPES, "Activity type");
  if ("activity_date" in b) patch.activity_date = date(String(b.activity_date).slice(0, 10), "Activity date");
  if ("description" in b) patch.description = reqText(b.description, "Activity description");
  for (const k of ["work_completed", "pending_work"]) if (k in b) patch[k] = text(b[k]);
  if ("next_followup" in b) patch.next_followup = optDate(b.next_followup, "Next follow-up");
  const r = await repo.updateActivity(uuid(req.params.id, "Activity"), patch, me(req));
  if ("error" in r) throw new AppError(404, "Activity not found", "NOT_FOUND");
  return sendSuccess(res, 200, { id: r.id }, "Activity updated");
}));

// ── Follow-up tasks ──────────────────────────────────────────────────────────
router.get("/tasks", wrap(async (req, res) => sendSuccess(res, 200, await repo.listTasks({
  salonId: qUuids(req.query.salon_id), developerId: qUuids(req.query.developer_id), status: qEnums(req.query.status, TASK_STATUSES),
  priority: qEnums(req.query.priority, TASK_PRIORITIES), bucket: qs(req.query.bucket), search: qs(req.query.search), ...page(req),
}), "Tasks fetched")));

router.post("/tasks", wrap(async (req, res) => {
  const b = req.body ?? {};
  const input = {
    salon_id: uuid(b.salon_id, "Salon"), developer_id: optUuid(b.developer_id, "Assigned team member"), title: reqText(b.title, "Task title", 200),
    description: text(b.description), priority: b.priority ? oneOf(b.priority, TASK_PRIORITIES, "Priority") : "medium", due_date: optDate(b.due_date, "Due date"),
  };
  await checkRefs(input.salon_id, input.developer_id);
  const id = await repo.createTask(input, me(req));
  return sendSuccess(res, 201, { id }, "Follow-up task created");
}));

router.patch("/tasks/:id", wrap(async (req, res) => {
  const b = req.body ?? {};
  const patch: Record<string, any> = {};
  if ("developer_id" in b) patch.developer_id = optUuid(b.developer_id, "Assigned team member");
  if ("title" in b) patch.title = reqText(b.title, "Task title", 200);
  if ("description" in b) patch.description = text(b.description);
  if ("priority" in b) patch.priority = oneOf(b.priority, TASK_PRIORITIES, "Priority");
  if ("due_date" in b) patch.due_date = optDate(b.due_date, "Due date");
  if ("status" in b) patch.status = oneOf(b.status, TASK_STATUSES, "Status");
  if ("completion_notes" in b) patch.completion_notes = text(b.completion_notes);
  const r = await repo.updateTask(uuid(req.params.id, "Task"), patch, me(req));
  if ("error" in r) {
    if (r.error === "NOT_FOUND") throw new AppError(404, "Task not found", "NOT_FOUND");
    throw bad("Add completion notes to complete a task");
  }
  return sendSuccess(res, 200, { id: r.id }, "Task updated");
}));

// ── Attachments ──────────────────────────────────────────────────────────────
const uploadDir = path.join(process.cwd(), "uploads", "client-activity");
fs.mkdirSync(uploadDir, { recursive: true });
const ALLOWED = /^(image\/|application\/pdf$|text\/(plain|csv)$|application\/(msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)))/;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, uploadDir),
    filename: (_r, f, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).slice(0, 10).replace(/[^.\w]/g, "")}`),
  }),
  fileFilter: (_r, f, cb) => (ALLOWED.test(f.mimetype) ? cb(null, true) : cb(new AppError(400, "Only images, PDF, Word, Excel, PowerPoint, CSV and text files are allowed", "VALIDATION_ERROR"))),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post("/attachments", upload.single("file"), wrap(async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw bad("Choose a file to upload");
  try {
    const entityType = oneOf(req.body?.entity_type, ATTACHMENT_ENTITIES, "Entity type");
    const entityId = uuid(req.body?.entity_id, "Record");
    const salonId = await repo.entitySalon(entityType, entityId);
    if (!salonId) throw new AppError(404, "Record not found", "NOT_FOUND");
    const row = await repo.addAttachment({
      salon_id: salonId, entity_type: entityType, entity_id: entityId, file_name: file.originalname.slice(0, 255),
      file_url: `/uploads/client-activity/${file.filename}`, mime_type: file.mimetype, size_bytes: file.size,
    }, me(req));
    return sendSuccess(res, 201, row, "File uploaded");
  } catch (e) {
    fs.unlink(file.path, () => undefined);   // don't leave an orphan file behind when the record check failed
    throw e;
  }
}));

router.get("/attachments", wrap(async (req, res) => {
  const entityType = oneOf(req.query.entity_type, ATTACHMENT_ENTITIES, "Entity type");
  return sendSuccess(res, 200, await repo.listAttachments(entityType, uuid(req.query.entity_id, "Record")), "Attachments fetched");
}));

// ── Audit trail + reports ────────────────────────────────────────────────────
router.get("/audit", wrap(async (req, res) => sendSuccess(res, 200, await repo.listAudit({
  salonId: qUuid(req.query.salon_id), entityType: qs(req.query.entity_type), entityId: qUuid(req.query.entity_id), ...page(req),
}), "Audit fetched")));

router.get("/reports", wrap(async (req, res) => sendSuccess(res, 200, await repo.reports({
  salonId: qUuid(req.query.salon_id), from: qDate(req.query.from), to: qDate(req.query.to), search: qs(req.query.search), ...page(req),
}), "Reports fetched")));

export default router;
