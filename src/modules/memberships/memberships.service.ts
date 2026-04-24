import { membershipsRepository } from "./memberships.repository";
import {
  CreateMembershipDTO, UpdateMembershipDTO,
} from "./memberships.types";

const normalize = (val?: string) =>
  val ? val.trim().toLowerCase() : val;

const parseTaxRate = (val?: string | number): number | undefined => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    if (val === "No tax" || val === "") return undefined;
    return parseFloat(val.replace("%", "").trim());
  }
  return undefined;
};

export const membershipsService = {

  async list(query: any) {
    return membershipsRepository.list({
      search:      query.search,
      sessionType: query.sessionType,
      validFor:    query.validFor,
      colour:      query.colour,
      page:        query.page  ? Number(query.page)  : undefined,
      limit:       query.limit ? Number(query.limit) : undefined,
    });
  },

  async listAll(query: any) {
    return membershipsRepository.listAll({
      search:      query.search,
      sessionType: query.sessionType,
      validFor:    query.validFor,
      colour:      query.colour,
    });
  },

  async create(data: CreateMembershipDTO) {
    data.sessionType = normalize(data.sessionType)!;
    data.validFor    = normalize(data.validFor)!;
    data.colour      = normalize(data.colour)!;
    if (data.sessionType !== "limited") data.numberOfSessions = undefined;
    if (isNaN(Number(data.price)) || Number(data.price) < 0)
      throw new Error("Invalid price value");
    data.price   = parseFloat(String(data.price));
    data.taxRate = parseTaxRate(data.taxRate as any);
    return membershipsRepository.create(data);
  },

  async getById(id: string) {
    const m = await membershipsRepository.findById(id);
    if (!m) throw new Error(`Membership '${id}' not found`);
    return m;
  },

  async update(id: string, data: UpdateMembershipDTO) {
    if (data.sessionType) data.sessionType = normalize(data.sessionType);
    if (data.validFor)    data.validFor    = normalize(data.validFor);
    if (data.colour)      data.colour      = normalize(data.colour);
    if (data.sessionType && data.sessionType !== "limited")
      data.numberOfSessions = undefined;
    data.taxRate = parseTaxRate(data.taxRate as any);
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