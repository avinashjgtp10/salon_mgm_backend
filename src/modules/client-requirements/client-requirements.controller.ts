import { Request, Response, NextFunction } from "express";
import { clientRequirementsService, formatReqNumber } from "./client-requirements.service";

type AuthedRequest = Request & { user?: { userId?: string; id?: string; salonId?: string } };

export const clientRequirementsController = {
  // POST /api/v1/requirements — Super Admin raises a requirement on behalf
  // of a salon (no salon-facing self-submission). salon_id is picked by the
  // admin from a dropdown; the "client" who receives notifications is that
  // salon's own owner, resolved server-side in the service layer.
  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const { salon_id, title, description, priority = "medium", target_date, status, developers } = req.body;
      if (!salon_id) {
        return res.status(400).json({ success: false, error: { message: "salon_id is required" } });
      }
      const requirement = await clientRequirementsService.submit({
        salon_id,
        title: String(title ?? "").trim(),
        description: String(description ?? "").trim(),
        priority,
        target_date: target_date || null,
        status,
        developers: Array.isArray(developers)
          ? developers
              .filter((d: any) => d?.developer_id)
              .map((d: any) => ({ developer_id: String(d.developer_id), role_label: d.role_label ? String(d.role_label) : null }))
          : [],
      });
      return res.status(201).json({ success: true, data: { ...requirement, req_number_label: formatReqNumber(requirement.req_number) } });
    } catch (err) { return next(err); }
  },

  // GET /api/v1/requirements/developers — assignable developer accounts
  async listDevelopers(_req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await clientRequirementsService.listDevelopers();
      return res.json({ success: true, data: rows });
    } catch (err) { return next(err); }
  },

  async listAllDevelopers(_req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await clientRequirementsService.listAllDevelopers();
      return res.json({ success: true, data: rows });
    } catch (err) { return next(err); }
  },

  async createDeveloper(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const { name, email, phone } = req.body;
      const createdBy = req.user?.userId ?? req.user?.id ?? null;
      const developer = await clientRequirementsService.createDeveloper({ name, email, phone, createdBy });
      return res.status(201).json({ success: true, data: developer });
    } catch (err) { return next(err); }
  },

  async setDeveloperStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { is_active } = req.body;
      if (typeof is_active !== "boolean") {
        return res.status(400).json({ success: false, error: { message: "is_active (boolean) required" } });
      }
      const updated = await clientRequirementsService.setDeveloperStatus(String(req.params.id), is_active);
      return res.json({ success: true, data: updated });
    } catch (err) { return next(err); }
  },

  // GET /api/v1/requirements — super admin lists all
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, priority, search } = req.query as Record<string, string>;
      const rows = await clientRequirementsService.getAllRequirements({ status: status as any, priority: priority as any, search });
      return res.json({ success: true, data: rows.map((r) => ({ ...r, req_number_label: formatReqNumber(r.req_number) })) });
    } catch (err) { return next(err); }
  },

  // GET /api/v1/requirements/stats
  async getStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await clientRequirementsService.getStats();
      return res.json({ success: true, data: stats });
    } catch (err) { return next(err); }
  },

  // GET /api/v1/requirements/:id — super admin detail (requirement + updates timeline)
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { requirement, updates } = await clientRequirementsService.getById(String(req.params.id));
      return res.json({
        success: true,
        data: { requirement: { ...requirement, req_number_label: formatReqNumber(requirement.req_number) }, updates },
      });
    } catch (err) { return next(err); }
  },

  // PATCH /api/v1/requirements/:id/assign
  async assign(req: Request, res: Response, next: NextFunction) {
    try {
      const { assigned_to, target_date } = req.body;
      const updated = await clientRequirementsService.assign(String(req.params.id), assigned_to || null, target_date || null);
      return res.json({ success: true, data: updated });
    } catch (err) { return next(err); }
  },

  // PATCH /api/v1/requirements/:id/status
  // notify defaults true (per spec, status changes always email both
  // sides) — the frontend only passes notify:false for the "Completed"
  // step's explicit Cancel/Complete & Notify confirmation when the admin
  // declines to notify.
  async changeStatus(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const { status, notify = true } = req.body;
      const actorId = req.user?.userId ?? req.user?.id ?? null;
      const updated = await clientRequirementsService.changeStatus(String(req.params.id), status, actorId, Boolean(notify));
      return res.json({ success: true, data: updated });
    } catch (err) { return next(err); }
  },

  // POST /api/v1/requirements/:id/updates — Internal Note or Client Update
  async addUpdate(req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const { update_type, message } = req.body;
      const actorId = req.user?.userId ?? req.user?.id ?? null;
      const saved = await clientRequirementsService.addUpdate(String(req.params.id), actorId, update_type, message);
      return res.status(201).json({ success: true, data: saved });
    } catch (err) { return next(err); }
  },
};
