import { Request, Response, NextFunction } from "express";
import { pricingService } from "./pricing.service";
import { sendSuccess } from "../utils/response.util";
import { getSalonId } from "../utils/salon.util";
import { CalculateTotalsBody } from "./pricing.types";

export const pricingController = {
  async calculateTotals(req: Request, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const body = req.body as CalculateTotalsBody;

      const data = await pricingService.calculateTotals(salonId, {
        client_id: body.client_id,
        appointment_id: body.appointment_id,
        serviceRows: body.serviceRows ?? [],
        packageRows: body.packageRows ?? [],
        productRows: body.productRows ?? [],
        membershipRows: body.membershipRows ?? [],
        discountType: body.discountType === 'percentage' ? 'percentage' : 'flat',
        discountValue: Number(body.discountValue) || 0,
        couponCode: body.couponCode,
        exCharges: Number(body.exCharges) || 0,
        tip: Number(body.tip) || 0,
        includeGst: body.includeGst !== false,
        applyEwallet: !!body.applyEwallet,
        eWalletRequested: Number(body.eWalletRequested) || 0,
        applyMembershipWallet: !!body.applyMembershipWallet,
        // Was omitted here entirely, so the preview always assumed the client's
        // full wallet balance and over-stated coverage whenever staff capped it.
        membershipWalletRequested: body.membershipWalletRequested !== undefined
          ? Number(body.membershipWalletRequested) || 0
          : undefined,
        applyMembershipDiscount: !!body.applyMembershipDiscount,
        applyRewardPoints: !!body.applyRewardPoints,
        rewardPointsToRedeem: Number(body.rewardPointsToRedeem) || 0,
        applyReferralCredit: !!body.applyReferralCredit,
        referralCreditRequested: Number(body.referralCreditRequested) || 0,
      });

      sendSuccess(res, 200, data, "Totals calculated successfully");
    } catch (error) {
      next(error);
    }
  },
};
