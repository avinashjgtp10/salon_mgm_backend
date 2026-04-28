import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { blockedTimesRepository } from "./blocked_times.repository";
import type {
  BlockedTime,
  CreateBlockedTimeBody,
  UpdateBlockedTimeBody,
  BlockedTimeFilters,
} from "./blocked_times.types";

export const blockedTimesService = {

  async create(params: {
    requesterUserId: string;
    body: CreateBlockedTimeBody;
  }): Promise<BlockedTime> {
    const { requesterUserId, body } = params;

    // Prevent creating a duplicate overlapping block for the same staff/date
    const overlap = await blockedTimesRepository.hasOverlap({
      staffId: body.staff_id,
      date: body.date,
      startTime: body.start_time,
      endTime: body.end_time,
    });
    if (overlap) {
      throw new AppError(
        409,
        "A blocked time already exists that overlaps this period for the selected staff.",
        "CONFLICT"
      );
    }

    const record = await blockedTimesRepository.create(body, requesterUserId);
    logger.info("blockedTimesService.create success", { id: record.id });
    return record;
  },

  async list(filters: BlockedTimeFilters): Promise<BlockedTime[]> {
    if (!filters.salon_id && !filters.staff_id) {
      throw new AppError(400, "salon_id or staff_id is required", "VALIDATION_ERROR");
    }
    return blockedTimesRepository.list(filters);
  },

  async getById(id: string): Promise<BlockedTime> {
    const record = await blockedTimesRepository.findById(id);
    if (!record) throw new AppError(404, "Blocked time not found", "NOT_FOUND");
    return record;
  },

  async update(params: {
    id: string;
    requesterUserId: string;
    patch: UpdateBlockedTimeBody;
  }): Promise<BlockedTime> {
    const { id, patch } = params;

    const existing = await blockedTimesRepository.findById(id);
    if (!existing) throw new AppError(404, "Blocked time not found", "NOT_FOUND");

    // Validate no overlap with other blocks (excluding self)
    const newStart = patch.start_time ?? existing.start_time;
    const newEnd = patch.end_time ?? existing.end_time;
    const newDate = patch.date ?? existing.date;
    const newStaffId = patch.staff_id ?? existing.staff_id;

    if (patch.start_time || patch.end_time || patch.date || patch.staff_id) {
      const overlap = await blockedTimesRepository.hasOverlap({
        staffId: newStaffId,
        date: newDate,
        startTime: newStart,
        endTime: newEnd,
        excludeId: id,
      });
      if (overlap) {
        throw new AppError(
          409,
          "Updated blocked time overlaps an existing block for this staff.",
          "CONFLICT"
        );
      }
    }

    const record = await blockedTimesRepository.update(id, patch);
    logger.info("blockedTimesService.update success", { id });
    return record;
  },

  async delete(id: string): Promise<BlockedTime> {
    const existing = await blockedTimesRepository.findById(id);
    if (!existing) throw new AppError(404, "Blocked time not found", "NOT_FOUND");

    const deleted = await blockedTimesRepository.deleteById(id);
    if (!deleted) throw new AppError(500, "Failed to delete blocked time", "INTERNAL_ERROR");

    logger.info("blockedTimesService.delete success", { id });
    return deleted;
  },
};
