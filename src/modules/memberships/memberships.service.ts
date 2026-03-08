import { membershipsRepository } from "./memberships.repository";  // ✅ fixed name
import {
  CreateMembershipDTO,
  UpdateMembershipDTO,
  MembershipsListQuery,
} from "./memberships.types";

const normalize = (val?: string) =>
  val ? val.trim().toLowerCase() : val;

export const membershipsService = {

  async list(query: MembershipsListQuery) {
    return membershipsRepository.list(query);  // ✅ fixed - query is now used
  },

  async create(data: CreateMembershipDTO) {
    data.sessionType = normalize(data.sessionType)!;
    data.validFor    = normalize(data.validFor)!;
    data.colour      = normalize(data.colour)!;
    if (data.sessionType !== "limited") data.numberOfSessions = undefined;
    return membershipsRepository.create(data);
  },

  async getById(id: string) {
    const m = await membershipsRepository.findById(id);
    if (!m) throw new Error(`Membership '${id}' not found`);
    return m;
  },

  async update(id: string, data: UpdateMembershipDTO) {
    if (data.sessionType)  data.sessionType = normalize(data.sessionType);
    if (data.validFor)     data.validFor    = normalize(data.validFor);
    if (data.colour)       data.colour      = normalize(data.colour);
    if (data.sessionType && data.sessionType !== "limited") {
      data.numberOfSessions = undefined;
    }
    const updated = await membershipsRepository.update(id, data);
    if (!updated) throw new Error(`Membership '${id}' not found`);
    return updated;
  },

  async delete(id: string) {
    const deleted = await membershipsRepository.delete(id);
    if (!deleted) throw new Error(`Membership '${id}' not found`);
    return { message: "Membership deleted successfully" };
  },
};