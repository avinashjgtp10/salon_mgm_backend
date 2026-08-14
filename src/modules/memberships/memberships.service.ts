import { membershipsRepository } from "./memberships.repository";
import { AppError } from "../../middleware/error.middleware";
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

  async list(query: any, salonId: string) {
    return membershipsRepository.list({
      search:      query.search,
      sessionType: query.sessionType,
      validFor:    query.validFor,
      pricingType: query.pricingType,
      appliesTo:   query.appliesTo,
      colour:      query.colour,
      page:        query.page  ? Number(query.page)  : undefined,
      limit:       query.limit ? Number(query.limit) : undefined,
    }, salonId);
  },

  // Whitelisted the same way as list() above — the export must apply exactly
  // the filters that were on screen, so any field added there belongs here too.
  async listAll(query: any, salonId: string) {
    return membershipsRepository.listAll({
      search:      query.search,
      sessionType: query.sessionType,
      validFor:    query.validFor,
      pricingType: query.pricingType,
      appliesTo:   query.appliesTo,
      colour:      query.colour,
    }, salonId);
  },

  async listFilterOptions(salonId: string) {
    return membershipsRepository.listFilterOptions(salonId);
  },

  async create(data: CreateMembershipDTO, salonId: string) {
    data.sessionType = normalize(data.sessionType)!;
    data.validFor    = normalize(data.validFor)!;
    data.colour      = normalize(data.colour)!;
    if (data.sessionType !== "limited") data.numberOfSessions = undefined;
    if (isNaN(Number(data.price)) || Number(data.price) < 0)
      throw new Error("Invalid price value");
    data.price   = parseFloat(String(data.price));
    data.taxRate = parseTaxRate(data.taxRate as any);
    return membershipsRepository.create(data, salonId);
  },

  async getLoyaltyEligibility(clientId: string, salonId: string) {
    return membershipsRepository.findLoyaltyEligibility(clientId, salonId);
  },

  async getById(id: string, salonId: string) {
    const m = await membershipsRepository.findById(id, salonId);
    if (!m) throw new Error(`Membership '${id}' not found`);
    return m;
  },

  async update(id: string, data: UpdateMembershipDTO, salonId: string) {
    // Pricing type is immutable once the plan exists. Each type funds a
    // different benefit, and every sold copy snapshots the type it was bought
    // under (client_memberships.pricing_type) — so changing it here can't
    // convert those, it only leaves the template disagreeing with its own sold
    // memberships and silently re-dates what the Member Sale report attributes
    // to them. Enforced server-side as well as in the modal: the UI lock alone
    // doesn't cover a direct API call or a tab opened before the plan changed.
    if (data.pricingType !== undefined) {
      const existing = await membershipsRepository.findById(id, salonId);
      if (!existing) throw new Error(`Membership '${id}' not found`);
      // findById returns the mapped Membership (camelCase), not the raw row.
      if (existing.pricingType !== data.pricingType) {
        throw new AppError(
          400,
          "Membership type can't be changed after the plan is created. Create a new membership instead.",
          "VALIDATION_ERROR"
        );
      }
    }
    if (data.sessionType) data.sessionType = normalize(data.sessionType);
    if (data.validFor)    data.validFor    = normalize(data.validFor);
    if (data.colour)      data.colour      = normalize(data.colour);
    if (data.sessionType && data.sessionType !== "limited")
      data.numberOfSessions = undefined;
    data.taxRate = parseTaxRate(data.taxRate as any);
    const updated = await membershipsRepository.update(id, data, salonId);
    if (!updated) throw new Error(`Membership '${id}' not found`);
    return updated;
  },

  async delete(id: string, salonId: string) {
    const deleted = await membershipsRepository.delete(id, salonId);
    if (!deleted) throw new Error(`Membership '${id}' not found`);
    return { message: "Membership deleted successfully" };
  },
};