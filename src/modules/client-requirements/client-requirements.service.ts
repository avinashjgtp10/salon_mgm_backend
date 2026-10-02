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

export const clientRequirementsService = {
  // Super Admin raises this on the salon's behalf — there's no salon-facing
  // self-submission, so the "client" (who gets the created/status/update
  // emails) is resolved here as that salon's own owner, the same
  // getSalonOwnerContact lookup already used for subscription-invoice
  // emails (salon-plans.service.ts).
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
    if (!owner?.owner_email) {
      throw new AppError(400, "This salon has no owner email on file — cannot notify a client for this requirement", "NO_OWNER_EMAIL");
    }

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
    const submitterName = owner.owner_name;
    const submitterEmail = owner.owner_email;
    const salonName = requirement.salon_name ?? owner.name ?? "Unknown";
    const reqNumber = formatReqNumber(requirement.req_number);

    emailService.sendRequirementCreatedEmail({
      reqNumber,
      title: requirement.title,
      description: requirement.description,
      priority: requirement.priority,
      salonName,
      submitterName,
      submitterEmail,
    }).catch((err) => console.error("Failed to send requirement created email:", err?.message ?? err));

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
      }).catch((err) => console.error(`Failed to send assignment email to ${assignee.developer_email}:`, err?.message ?? err));
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

  async listAllDevelopers() {
    return clientRequirementsRepository.listAllDevelopers();
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

    if (notify && existing.submitter_email) {
      if (newStatus === "completed") {
        emailService.sendRequirementCompletedEmail({
          reqNumber: formatReqNumber(existing.req_number),
          title: existing.title,
          submitterEmail: existing.submitter_email,
        }).catch((err) => console.error("Failed to send requirement completed email:", err?.message ?? err));
      } else {
        emailService.sendRequirementStatusChangedEmail({
          reqNumber: formatReqNumber(existing.req_number),
          title: existing.title,
          salonName: existing.salon_name ?? "Unknown",
          submitterEmail: existing.submitter_email,
          newStatus,
          newStatusLabel: STATUS_LABEL[newStatus],
        }).catch((err) => console.error("Failed to send requirement status email:", err?.message ?? err));
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

    if (shouldEmail && requirement.submitter_email) {
      emailService.sendRequirementUpdateEmail({
        reqNumber: formatReqNumber(requirement.req_number),
        title: requirement.title,
        salonName: requirement.salon_name ?? "Unknown",
        submitterEmail: requirement.submitter_email,
        authorName: requirement.assignee_name ?? null,
        message: message.trim(),
      }).catch((err) => console.error("Failed to send requirement update email:", err?.message ?? err));
    }

    return saved;
  },
};
