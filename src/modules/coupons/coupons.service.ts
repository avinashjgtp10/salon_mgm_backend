import { randomUUID } from 'crypto';
import { AppError } from '../../middleware/error.middleware';
import { couponsRepository } from './coupons.repository';
import {
  Coupon,
  CreateBulkCouponsBody,
  CreateCouponBody,
  UpdateCouponBody,
  ValidateCouponBody,
  ValidateCouponResult,
} from './coupons.types';

// Excludes 0/O/1/I — these get handed out as printed vouchers, where the two
// are easy to misread.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(length = 4): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function validateCouponFields(body: Partial<CreateCouponBody>, isCreate: boolean, requireCode = isCreate) {
  if (requireCode && (!body.code || !body.code.trim()))
    throw new AppError(400, 'code is required', 'VALIDATION_ERROR');
  if (body.type !== undefined && body.type !== 'percentage' && body.type !== 'flat')
    throw new AppError(400, "type must be 'percentage' or 'flat'", 'VALIDATION_ERROR');
  if (isCreate && body.type === undefined)
    throw new AppError(400, 'type is required', 'VALIDATION_ERROR');
  if (body.value !== undefined) {
    if (typeof body.value !== 'number' || body.value <= 0)
      throw new AppError(400, 'value must be a positive number', 'VALIDATION_ERROR');
    if (body.type === 'percentage' && body.value > 100)
      throw new AppError(400, 'A percentage coupon cannot exceed 100', 'VALIDATION_ERROR');
  } else if (isCreate) {
    throw new AppError(400, 'value is required', 'VALIDATION_ERROR');
  }
  if (body.min_order_amount !== undefined && (typeof body.min_order_amount !== 'number' || body.min_order_amount < 0))
    throw new AppError(400, 'min_order_amount must be >= 0', 'VALIDATION_ERROR');
  if (body.max_uses !== undefined && body.max_uses !== null && (typeof body.max_uses !== 'number' || body.max_uses <= 0))
    throw new AppError(400, 'max_uses must be a positive number or null', 'VALIDATION_ERROR');
  if (isCreate && !body.expires_at)
    throw new AppError(400, 'expires_at is required', 'VALIDATION_ERROR');
  if (body.expires_at !== undefined && isNaN(new Date(body.expires_at).getTime()))
    throw new AppError(400, 'expires_at must be a valid date', 'VALIDATION_ERROR');
}

export const couponsService = {

  async listOwn(salonId: string): Promise<Coupon[]> {
    return couponsRepository.listOwn(salonId);
  },

  async create(body: CreateCouponBody, salonId: string): Promise<Coupon> {
    validateCouponFields(body, true);
    const existing = await couponsRepository.findByCodeOwn(body.code, salonId);
    if (existing) throw new AppError(409, 'A coupon with this code already exists', 'DUPLICATE_CODE');
    return couponsRepository.create(body, salonId);
  },

  async update(id: string, patch: UpdateCouponBody, salonId: string): Promise<Coupon> {
    const existing = await couponsRepository.findByIdOwn(id, salonId);
    if (!existing) throw new AppError(404, 'Coupon not found', 'NOT_FOUND');
    validateCouponFields(patch, false);
    if (patch.code && patch.code.trim().toUpperCase() !== existing.code) {
      const dup = await couponsRepository.findByCodeOwn(patch.code, salonId);
      if (dup) throw new AppError(409, 'A coupon with this code already exists', 'DUPLICATE_CODE');
    }
    const updated = await couponsRepository.update(id, patch, salonId);
    return updated as Coupon;
  },

  async remove(id: string, salonId: string): Promise<void> {
    const existing = await couponsRepository.findByIdOwn(id, salonId);
    if (!existing) throw new AppError(404, 'Coupon not found', 'NOT_FOUND');
    await couponsRepository.remove(id, salonId);
  },

  async removeBatch(batchId: string, salonId: string): Promise<number> {
    const deleted = await couponsRepository.removeByBatch(batchId, salonId);
    if (deleted === 0) throw new AppError(404, 'Coupon batch not found', 'NOT_FOUND');
    return deleted;
  },

  // Generates `count` unique codes as PREFIX + 4-char random suffix, then
  // inserts them all sharing one discount rule — for handing out a batch of
  // printed vouchers where each one needs its own single-use code.
  //
  // Collisions are checked in ONE batch query per round, not one query per
  // candidate — checking 50+ candidates individually meant 50+ sequential
  // round trips to the DB, which timed out well before finishing.
  async createBulk(body: CreateBulkCouponsBody, salonId: string): Promise<Coupon[]> {
    const prefix = (body.prefix || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) throw new AppError(400, 'prefix is required', 'VALIDATION_ERROR');
    if (!Number.isInteger(body.count) || body.count < 1 || body.count > 500) {
      throw new AppError(400, 'count must be an integer between 1 and 500', 'VALIDATION_ERROR');
    }
    validateCouponFields(body, true, false);

    const fillTo = (existing: Set<string>) => {
      while (existing.size < body.count) existing.add(`${prefix}${randomSuffix()}`);
      return existing;
    };

    let candidates = Array.from(fillTo(new Set<string>()));

    for (let round = 0; round < 5; round++) {
      const taken = new Set(await couponsRepository.findExistingCodes(candidates, salonId));
      if (taken.size === 0) break;
      if (round === 4) throw new AppError(500, 'Could not generate enough unique codes — try a different prefix', 'CODE_GENERATION_FAILED');
      const unique = fillTo(new Set(candidates.filter((c) => !taken.has(c))));
      candidates = Array.from(unique);
    }

    return couponsRepository.createMany(candidates, body, salonId, randomUUID(), prefix);
  },

  async validate(body: ValidateCouponBody): Promise<ValidateCouponResult> {
    const { code, orderAmount, salonId } = body;
    const coupon = await couponsRepository.findByCodeForSalon(code, salonId);

    if (!coupon || !coupon.is_active)
      throw new AppError(400, 'Coupon code is invalid or inactive', 'INVALID_COUPON');

    // expires_at is a DATE column — pg returns it at UTC midnight, so comparing
    // directly against "now" makes the coupon look expired from early morning
    // UTC onward on its expiry day, hours before that day is actually over.
    // A coupon should stay valid through the full calendar day it expires.
    const expiryEndOfDay = new Date(coupon.expires_at);
    expiryEndOfDay.setUTCHours(23, 59, 59, 999);
    if (expiryEndOfDay < new Date())
      throw new AppError(400, 'This coupon has expired', 'COUPON_EXPIRED');

    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses)
      throw new AppError(400, 'Coupon usage limit has been reached', 'COUPON_LIMIT_REACHED');

    if (orderAmount < Number(coupon.min_order_amount))
      throw new AppError(
        400,
        `Minimum order amount of ₹${coupon.min_order_amount} required for this coupon`,
        'MIN_ORDER_NOT_MET'
      );

    const discountAmount =
      coupon.type === 'percentage'
        ? (orderAmount * Number(coupon.value)) / 100
        : Number(coupon.value);

    const capped = Math.min(orderAmount, discountAmount);
    const finalAmount = Math.max(0, orderAmount - capped);

    return {
      valid: true,
      couponCode: coupon.code,
      discountType: coupon.type,
      discountValue: Number(coupon.value),
      discountAmount: Math.round(capped * 100) / 100,
      finalAmount: Math.round(finalAmount * 100) / 100,
      message: `Coupon applied! You save ₹${capped.toFixed(2)}`,
    };
  },
};
