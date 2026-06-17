import { membershipsRepository } from "./memberships.repository";
import {
  CreateMembershipDTO,
  CreateMembershipInput,
  MembershipsFilterQuery,
  MembershipsListQuery,
  UpdateMembershipDTO,
  UpdateMembershipInput,
} from "./memberships.types";

const normalize = (val?: string) =>
  val ? val.trim().toLowerCase() : val;

const normalizeQueryValue = (val?: string): string | undefined => {
  const normalized = normalize(val);
  return normalized ? normalized : undefined;
};

const parseBooleanQuery = (val: unknown): boolean | undefined => {
  if (typeof val === "boolean") return val;
  if (typeof val !== "string") return undefined;

  const normalized = val.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
};

const parseTaxRate = (val?: string | number): number | undefined => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    if (val === "No tax" || val.trim() === "") return undefined;
    return parseFloat(val.replace("%", "").trim());
  }
  return undefined;
};

const extractSessionCount = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(/\d+/);
  if (!match) return undefined;

  const parsed = Number(match[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const normalizeSessionType = (
  sessionType: unknown,
  numberOfSessions: unknown,
  sessions: unknown
): { sessionType: string; numberOfSessions?: number } => {
  const normalizedSessionType = normalize(typeof sessionType === "string" ? sessionType : undefined);
  const parsedCount = extractSessionCount(numberOfSessions) ?? extractSessionCount(sessions);

  if (normalizedSessionType === "unlimited") {
    return { sessionType: "unlimited" };
  }

  if (normalizedSessionType === "limited") {
    return { sessionType: "limited", numberOfSessions: parsedCount };
  }

  if (typeof sessions === "string" && normalize(sessions) === "unlimited") {
    return { sessionType: "unlimited" };
  }

  if (parsedCount !== undefined) {
    return { sessionType: "limited", numberOfSessions: parsedCount };
  }

  return { sessionType: normalizedSessionType ?? "unlimited" };
};

const parseListQuery = (query: MembershipsListQuery | Record<string, any>): MembershipsListQuery => ({
  search: query.search,
  sessionType: normalizeQueryValue(query.sessionType),
  sessions: normalizeQueryValue(
    query.sessions ??
    (query.numberOfSessions !== undefined ? String(query.numberOfSessions) : undefined)
  ),
  validFor: normalizeQueryValue(query.validFor),
  colour: normalizeQueryValue(query.colour),
  onlyAllServices: parseBooleanQuery(query.onlyAllServices),
  page: query.page ? Number(query.page) : undefined,
  limit: query.limit ? Number(query.limit) : undefined,
});

const parseFilterQuery = (
  query: MembershipsFilterQuery | Record<string, any>
): MembershipsListQuery => parseListQuery(query);

const normalizeCreatePayload = (data: CreateMembershipInput): CreateMembershipDTO => {
  const sessionData = normalizeSessionType(data.sessionType, data.numberOfSessions, data.sessions);

  if (isNaN(Number(data.price)) || Number(data.price) < 0) {
    throw new Error("Invalid price value");
  }

  return {
    name: data.name,
    description: data.description,
    includedServices: data.includedServices,
    sessionType: sessionData.sessionType,
    numberOfSessions: sessionData.numberOfSessions,
    validFor: normalize(data.validFor)!,
    price: parseFloat(String(data.price)),
    taxRate: parseTaxRate(data.taxRate),
    colour: normalize(data.colour)!,
    enableOnlineSales: data.enableOnlineSales,
    enableOnlineRedemption: data.enableOnlineRedemption,
    termsAndConditions: data.termsAndConditions,
  };
};

const normalizeUpdatePayload = (data: UpdateMembershipInput): UpdateMembershipDTO => {
  const patch: UpdateMembershipDTO = {};

  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.includedServices !== undefined) patch.includedServices = data.includedServices;
  if (data.enableOnlineSales !== undefined) patch.enableOnlineSales = data.enableOnlineSales;
  if (data.enableOnlineRedemption !== undefined) {
    patch.enableOnlineRedemption = data.enableOnlineRedemption;
  }
  if (data.termsAndConditions !== undefined) {
    patch.termsAndConditions = data.termsAndConditions;
  }

  if (data.sessionType !== undefined || data.numberOfSessions !== undefined || data.sessions !== undefined) {
    const sessionData = normalizeSessionType(data.sessionType, data.numberOfSessions, data.sessions);
    patch.sessionType = sessionData.sessionType;
    patch.numberOfSessions = sessionData.numberOfSessions;
  }

  if (data.validFor !== undefined) patch.validFor = normalize(data.validFor);
  if (data.colour !== undefined) patch.colour = normalize(data.colour);
  if (data.price !== undefined) {
    if (isNaN(Number(data.price)) || Number(data.price) < 0) {
      throw new Error("Invalid price value");
    }
    patch.price = parseFloat(String(data.price));
  }
  if ("taxRate" in data) patch.taxRate = parseTaxRate(data.taxRate);
  return patch;
};

export const membershipsService = {
  async list(query: MembershipsListQuery | Record<string, any>, salonId: string) {
    return membershipsRepository.list(parseListQuery(query), salonId);
  },

  async filter(query: MembershipsFilterQuery | Record<string, any>, salonId: string) {
    const memberships = await membershipsRepository.listAll(parseFilterQuery(query), salonId);
    return { memberships, total: memberships.length };
  },

  async listAll(query: MembershipsListQuery | Record<string, any>, salonId: string) {
    return membershipsRepository.listAll(parseListQuery(query), salonId);
  },

  async create(data: CreateMembershipInput, salonId: string) {
    return membershipsRepository.create(normalizeCreatePayload(data), salonId);
  },

  async getById(id: string, salonId: string) {
    const membership = await membershipsRepository.findById(id, salonId);
    if (!membership) throw new Error(`Membership '${id}' not found`);
    return membership;
  },

  async update(id: string, data: UpdateMembershipInput, salonId: string) {
    const updated = await membershipsRepository.update(id, normalizeUpdatePayload(data), salonId);
    if (!updated) throw new Error(`Membership '${id}' not found`);
    return updated;
  },

  async delete(id: string, salonId: string) {
    const deleted = await membershipsRepository.delete(id, salonId);
    if (!deleted) throw new Error(`Membership '${id}' not found`);
    return { message: "Membership deleted successfully" };
  },
};
