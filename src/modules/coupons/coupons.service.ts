import { AppError } from '../../middleware/error.middleware';
import { couponsRepository } from './coupons.repository';
import { ValidateCouponBody, ValidateCouponResult } from './coupons.types';

export const couponsService = {

  async validate(body: ValidateCouponBody): Promise<ValidateCouponResult> {
    const { code, orderAmount } = body;
    const coupon = await couponsRepository.findByCode(code);

    if (!coupon || !coupon.is_active)
      throw new AppError(400, 'Coupon code is invalid or inactive', 'INVALID_COUPON');

    if (new Date(coupon.expires_at) < new Date())
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
