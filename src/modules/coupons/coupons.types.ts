export type CouponType = 'percentage' | 'flat';

export type Coupon = {
  id: string;
  salon_id: string | null;
  code: string;
  type: CouponType;
  value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ValidateCouponBody = {
  code: string;
  orderAmount: number;
  salonId?: string;
};

export type ValidateCouponResult = {
  valid: boolean;
  couponCode: string;
  discountType: CouponType;
  discountValue: number;
  discountAmount: number;
  finalAmount: number;
  message: string;
};
