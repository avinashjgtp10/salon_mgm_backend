import { AppError } from '../../middleware/error.middleware';
import { couponDesignsRepository } from './coupon-designs.repository';
import {
  CouponDesign,
  CreateCouponDesignBody,
  DesignDoc,
  ListCouponDesignsQuery,
  UpdateCouponDesignBody,
} from './coupon-designs.types';

/**
 * Highest doc schemaVersion this server understands.
 *
 * The server does NOT interpret element shapes — it stores `doc` verbatim — so
 * this is a compatibility floor, not a parser version. It exists to reject a
 * doc written by a NEWER frontend than the API, which would otherwise be saved
 * and then silently mis-rendered by the (older) server-side exporter.
 * Bump it in lockstep with SCHEMA_VERSION in the editor's schema.ts.
 */
export const SCHEMA_VERSION = 1;

// A design bigger than this is almost always a mistake (a wrong unit, or a
// preset in mm treated as px) and would OOM the exporter later.
const MAX_DIMENSION_PX = 10000;

function validateDoc(doc: unknown): asserts doc is DesignDoc {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    throw new AppError(400, 'doc must be an object', 'VALIDATION_ERROR');

  const d = doc as Record<string, unknown>;
  const version = Number(d.schemaVersion);
  if (!Number.isInteger(version) || version < 1)
    throw new AppError(400, 'doc.schemaVersion is required', 'VALIDATION_ERROR');
  if (version > SCHEMA_VERSION)
    throw new AppError(
      400,
      `This design was made with a newer version of the editor (v${version}). Refresh the page and try again.`,
      'SCHEMA_TOO_NEW',
    );
  if (!Array.isArray(d.elements))
    throw new AppError(400, 'doc.elements must be an array', 'VALIDATION_ERROR');
}

function validateSize(width: unknown, height: unknown) {
  for (const [label, value] of [['width_px', width], ['height_px', height]] as const) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0)
      throw new AppError(400, `${label} must be a positive number`, 'VALIDATION_ERROR');
    if (Number(value) > MAX_DIMENSION_PX)
      throw new AppError(400, `${label} cannot exceed ${MAX_DIMENSION_PX}px`, 'VALIDATION_ERROR');
  }
}

export const couponDesignsService = {
  async list(salonId: string, query: ListCouponDesignsQuery) {
    return couponDesignsRepository.list(salonId, query);
  },

  async get(id: string, salonId: string): Promise<CouponDesign> {
    const design = await couponDesignsRepository.findById(id, salonId);
    if (!design) throw new AppError(404, 'Design not found', 'NOT_FOUND');
    return design;
  },

  async create(body: CreateCouponDesignBody, salonId: string, userId: string | null): Promise<CouponDesign> {
    validateSize(body.width_px, body.height_px);
    validateDoc(body.doc);
    return couponDesignsRepository.create(body, salonId, userId);
  },

  async update(id: string, patch: UpdateCouponDesignBody, salonId: string): Promise<CouponDesign> {
    const existing = await couponDesignsRepository.findById(id, salonId);
    if (!existing) throw new AppError(404, 'Design not found', 'NOT_FOUND');
    // A global starter template is readable by everyone but owned by nobody;
    // editing it must go through Duplicate, or one salon's edit would change
    // the template every other salon sees.
    if (existing.salon_id === null)
      throw new AppError(
        403,
        'Starter templates cannot be edited directly — duplicate it first',
        'TEMPLATE_READONLY',
      );

    if (patch.width_px !== undefined || patch.height_px !== undefined) {
      validateSize(patch.width_px ?? existing.width_px, patch.height_px ?? existing.height_px);
    }
    if (patch.doc !== undefined) validateDoc(patch.doc);

    const updated = await couponDesignsRepository.update(id, patch, salonId);
    if (!updated) throw new AppError(404, 'Design not found', 'NOT_FOUND');
    return updated;
  },

  async duplicate(id: string, salonId: string, userId: string | null, name?: string): Promise<CouponDesign> {
    const copy = await couponDesignsRepository.duplicate(id, salonId, userId, name);
    if (!copy) throw new AppError(404, 'Design not found', 'NOT_FOUND');
    return copy;
  },

  async remove(id: string, salonId: string): Promise<void> {
    const existing = await couponDesignsRepository.findById(id, salonId);
    if (!existing) throw new AppError(404, 'Design not found', 'NOT_FOUND');
    if (existing.salon_id === null)
      throw new AppError(403, 'Starter templates cannot be deleted', 'TEMPLATE_READONLY');
    await couponDesignsRepository.remove(id, salonId);
  },
};
