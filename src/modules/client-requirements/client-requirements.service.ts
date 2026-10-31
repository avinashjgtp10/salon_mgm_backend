import logger from '../../config/logger';
import { AppError } from "../../middleware/error.middleware";
import { emailService } from "../utils/email.service";
import { superAdminRepository } from "../super-admin/super-admin.repository";
import { clientRequirementsRepository } from "./client-requirements.repository";
import type {
  ListRequirementsFilters,
  RequirementPriority,
  RequirementStatus,
  UpdateType,
} from "./client-requirements.types";

const STATUS_LABEL: Record<RequirementStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

export function formatReqNumber(n: number): string {
  return `REQ-${String(n).padStart(3, "0")}`;
}

// Unique, non-empty emails of the developers assigned to a requirement.
const developerEmails = (r: { assignees?: { developer_email: string }[] | null }): string[] =>
  [...new Set((r.assignees ?? []).map((a) => a.developer_email?.trim()).filter((e): e is string => !!e))];

export const clientRequirementsService = {
  // Super Admin raises this on the salon's behalf — there's no salon-facing
  // self-submission, so the "client" (who gets the created/status/update
  // emails) is resolved here as that salon's own owner.
  async submit(data: {
    salon_id: string;
    title: string;
    description: string;
    priority: RequirementPriority;
    target_date?: string | null;
    status?: RequirementStatus;
    developers?: { developer_id: string; role_label?: string | null }[];
  }) {
    if (!data.title?.trim()) throw new AppError(400, "Title is required", "VALIDATION_ERROR");
    if (!data.description?.trim()) throw new AppError(400, "Description is required", "VALIDATION_ERROR");
    if (!["low", "medium", "high"].includes(data.priority)) {
      throw new AppError(400, "Invalid priority", "VALIDATION_ERROR");
    }
    if (data.status && !["open", "in_progress", "completed"].includes(data.status)) {
      throw new AppError(400, "Invalid status", "VALIDATION_ERROR");
    }

    const owner = await superAdminRepository.getSalonOwnerContact(data.salon_id);

    // Every developer row needs a real email to notify — dedupe by
    // developer_id (the UI's "+ Add Developer" doesn't prevent picking the
    // same person twice) before insert.
    const seen = new Set<string>();
    const developers = (data.developers ?? []).filter((d) => {
      if (!d.developer_id || seen.has(d.developer_id)) return false;
      seen.add(d.developer_id);
      return true;
    });

    const created = await clientRequirementsRepository.create({
      salon_id: data.salon_id,
      user_id: null,
      title: data.title,
      description: data.description,
      priority: data.priority,
      target_date: data.target_date ?? null,
      status: data.status ?? "open",
      developers,
    });
    const full = await clientRequirementsRepository.findById(created.id);
    const requirement = full ?? created;
    // Owner contact stands in for the missing user_id join in the salon
    // creation path — submitter_name/email are always sourced via
    // getSalonOwnerContact here, never from a users row this requirement
    // is FK'd to.
    const submitterName = owner?.owner_name ?? null;
    const submitterEmail = owner?.owner_email ?? "";
    const salonName = requirement.salon_name ?? owner?.name ?? "Unknown";
    const reqNumber = formatReqNumber(requirement.req_number);

    // Emails go to the assigned developers only — the salon owner is never emailed.
    // Every assigned developer gets their own "you've been assigned" email
    // — separate from the client-confirmation / internal-team-notification
    // pair sendRequirementCreatedEmail already sends.
    for (const assignee of requirement.assignees ?? []) {
      emailService.sendRequirementAssignedEmail({
        to: assignee.developer_email,
        developerName: assignee.developer_name,
        reqNumber,
        title: requirement.title,
        salonName,
        priority: requirement.priority,
        targetDate: requirement.target_date,
      }).catch((err) => logger.error(`Failed to send assignment email to ${assignee.developer_email}:`, err?.message ?? err));
    }

    return { ...requirement, submitter_name: submitterName, submitter_email: submitterEmail };
  },

  async getAllRequirements(filters: ListRequirementsFilters) {
    return clientRequirementsRepository.findAll(filters);
  },

  async listDevelopers() {
    return clientRequirementsRepository.listDevelopers();
  },

  // "Manage Team" page — creates a plain developer contact record (name +
  // email, no password, no login, no platform access). They exist solely
  // to be assignable on a requirement and receive assignment/status emails.
  async createDeveloper(data: { name: string; email: string; phone?: string; createdBy?: string | null }) {
    if (!data.name?.trim()) throw new AppError(400, "Name is required", "VALIDATION_ERROR");
    if (!data.email?.trim()) throw new AppError(400, "Email is required", "VALIDATION_ERROR");

    return clientRequirementsRepository.createDeveloper({
      name: data.name.trim(),
      email: data.email,
      phone: data.phone?.trim(),
      createdBy: data.createdBy ?? null,
    });
  },

  // Real Salons > Actions > Assign Developer: saves which developers look after a salon.
  async setSalonDevelopers(salonId: string, developerIds: unknown) {
    if (!Array.isArray(developerIds)) throw new AppError(400, "developer_ids (array) required", "VALIDATION_ERROR");
    const ids = [...new Set(developerIds.map(String).filter(Boolean))];
    await clientRequirementsRepository.setSalonDevelopers(salonId, ids);
    return { salon_id: salonId, developer_ids: ids };
  },

  async listAllDevelopers() {
    return clientRequirementsRepository.listAllDevelopers();
  },

  async deleteDeveloper(id: string) {
    const ok = await clientRequirementsRepository.deleteDeveloper(id);
    if (!ok) throw new AppError(404, "Developer not found", "NOT_FOUND");
  },

  async setDeveloperStatus(id: string, isActive: boolean) {
    const updated = await clientRequirementsRepository.setDeveloperStatus(id, isActive);
    if (!updated) throw new AppError(404, "Developer not found", "NOT_FOUND");
    return updated;
  },

  async getById(id: string) {
    const requirement = await clientRequirementsRepository.findById(id);
    if (!requirement) throw new AppError(404, "Requirement not found", "NOT_FOUND");
    const updates = await clientRequirementsRepository.listUpdates(id);
    return { requirement, updates };
  },

  async getStats() {
    return clientRequirementsRepository.getStats();
  },

  // Row-level "Assigned Developer" picker: the requirement's developers become exactly `developerIds`; developers
  // newly added get the usual "you've been assigned" email (nobody else is emailed).
  async setAssignees(id: string, developerIds: unknown) {
    if (!Array.isArray(developerIds)) throw new AppError(400, "developer_ids (array) required", "VALIDATION_ERROR");
    const ids = [...new Set(developerIds.map(String).filter(Boolean))];
    const { updated, added } = await clientRequirementsRepository.setAssignees(id, ids);
    if (!updated) throw new AppError(404, "Requirement not found", "NOT_FOUND");

    const full = await clientRequirementsRepository.findById(id);
    if (full) {
      for (const a of (full.assignees ?? []).filter((x) => added.includes(x.developer_id))) {
        emailService.sendRequirementAssignedEmail({
          to: a.developer_email,
          developerName: a.developer_name,
          reqNumber: formatReqNumber(full.req_number),
          title: full.title,
          salonName: full.salon_name ?? "Unknown",
          priority: full.priority,
          targetDate: full.target_date,
        }).catch((err) => logger.error(`Failed to send assignment email to ${a.developer_email}:`, err?.message ?? err));
      }
    }
    return full ?? updated;
  },

  async updateDetails(id: string, actorId: string | null, data: { title?: string; description?: string; priority?: RequirementPriority; target_date?: string | null }) {
    const existing = await clientRequirementsRepository.findById(id);
    if (!existing) throw new AppError(404, "Requirement not found", "NOT_FOUND");

    const title = (data.title ?? existing.title)?.trim();
    const description = (data.description ?? existing.description)?.trim();
    const priority = data.priority ?? existing.priority;
    if (!title) throw new AppError(400, "Title is required", "VALIDATION_ERROR");
    if (!description) throw new AppError(400, "Description is required", "VALIDATION_ERROR");
    if (!["low", "medium", "high"].includes(priority)) throw new AppError(400, "Invalid priority", "VALIDATION_ERROR");
    const targetDate = data.target_date === undefined ? existing.target_date : (data.target_date || null);

    const updated = await clientRequirementsRepository.updateDetails(id, { title, description, priority, target_date: targetDate });
    if (!updated) throw new AppError(404, "Requirement not found", "NOT_FOUND");

    // Team-only timeline note (no email) so the change is traceable.
    await clientRequirementsRepository.addUpdate({
      requirement_id: id,
      author_id: actorId,
      update_type: "internal_note",
      message: "Issue details were edited",
      emailed: false,
    });
    return (await clientRequirementsRepository.findById(id)) ?? updated;
  },

  async deleteRequirement(id: string) {
    const ok = await clientRequirementsRepository.deleteById(id);
    if (!ok) throw new AppError(404, "Requirement not found", "NOT_FOUND");
  },

  async assign(id: string, assigneeId: string | null, targetDate: string | null) {
    const updated = await clientRequirementsRepository.assign(id, assigneeId, targetDate);
    if (!updated) throw new AppError(404, "Requirement not found", "NOT_FOUND");
    return updated;
  },

  // Status change: logs a status_change timeline entry AND always emails
  // both client and team (per spec — "Open → In Progress" fires both
  // emails automatically, no opt-out). Completing additionally offers the
  // controller a "confirm before notifying" step (see controller), so this
  // method takes an explicit `notify` flag rather than always emailing.
  async changeStatus(id: string, newStatus: RequirementStatus, actorId: string | null, notify: boolean) {
    const allowed: RequirementStatus[] = ["open", "in_progress", "completed"];
    if (!allowed.includes(newStatus)) throw new AppError(400, "Invalid status", "VALIDATION_ERROR");

    const existing = await clientRequirementsRepository.findById(id);
    if (!existing) throw new AppError(404, "Requirement not found", "NOT_FOUND");

    const updated = await clientRequirementsRepository.updateStatus(id, newStatus);
    if (!updated) throw new AppError(404, "Requirement not found", "NOT_FOUND");

    await clientRequirementsRepository.addUpdate({
      requirement_id: id,
      author_id: actorId,
      update_type: "status_change",
      message: `Status changed from ${STATUS_LABEL[existing.status]} to ${STATUS_LABEL[newStatus]}`,
      old_status: existing.status,
      new_status: newStatus,
      emailed: notify,
    });

    const to = developerEmails(existing);
    if (notify && to.length > 0) {
      if (newStatus === "completed") {
        emailService.sendRequirementCompletedEmail({
          reqNumber: formatReqNumber(existing.req_number),
          title: existing.title,
          to,
        }).catch((err) => logger.error("Failed to send requirement completed email:", err?.message ?? err));
      } else {
        emailService.sendRequirementStatusChangedEmail({
          reqNumber: formatReqNumber(existing.req_number),
          title: existing.title,
          salonName: existing.salon_name ?? "Unknown",
          to,
          newStatus,
          newStatusLabel: STATUS_LABEL[newStatus],
        }).catch((err) => logger.error("Failed to send requirement status email:", err?.message ?? err));
      }
    }

    return updated;
  },

  // Internal Note: team-only, no email, just a timeline entry.
  // Client Update: emails client + team, saved permanently in history.
  async addUpdate(id: string, actorId: string | null, updateType: UpdateType, message: string) {
    if (!message?.trim()) throw new AppError(400, "Update message is required", "VALIDATION_ERROR");
    if (!["internal_note", "client_update"].includes(updateType)) {
      throw new AppError(400, "Invalid update type", "VALIDATION_ERROR");
    }

    const requirement = await clientRequirementsRepository.findById(id);
    if (!requirement) throw new AppError(404, "Requirement not found", "NOT_FOUND");

    const shouldEmail = updateType === "client_update";
    const saved = await clientRequirementsRepository.addUpdate({
      requirement_id: id,
      author_id: actorId,
      update_type: updateType,
      message: message.trim(),
      emailed: shouldEmail,
    });

    const to = developerEmails(requirement);
    if (shouldEmail && to.length > 0) {
      emailService.sendRequirementUpdateEmail({
        reqNumber: formatReqNumber(requirement.req_number),
        title: requirement.title,
        salonName: requirement.salon_name ?? "Unknown",
        to,
        authorName: requirement.assignee_name ?? null,
        message: message.trim(),
      }).catch((err) => logger.error("Failed to send requirement update email:", err?.message ?? err));
    }

    return saved;
  },
};
