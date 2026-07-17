import { AppError } from "../../middleware/error.middleware";
import { clientsRepository } from "../clients/clients.repository";
import { ewalletRepository } from "./ewallet.repository";
import { EwalletLedgerEntry, WalletBreakdown } from "./ewallet.types";

export const ewalletService = {
  async topUp(
    clientId: string,
    salonId: string,
    amount: number,
    paymentMethod: string | undefined,
    note: string | undefined,
    createdBy: string,
  ): Promise<{ balance: number }> {
    if (!isFinite(amount) || amount <= 0) {
      throw new AppError(400, "amount must be a positive number", "VALIDATION_ERROR");
    }
    if (!paymentMethod || !["cash", "card", "upi"].includes(paymentMethod.toLowerCase())) {
      throw new AppError(400, "payment_method must be one of cash, card, upi", "VALIDATION_ERROR");
    }
    const client = await clientsRepository.findById(clientId, salonId);
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

    const balance = await ewalletRepository.applyLedgerEntry({
      clientId,
      salonId,
      type: "topup",
      delta: amount,
      sourceType: "manual",
      paymentMethod: paymentMethod.toLowerCase(),
      note: note || undefined,
      createdBy,
    });
    return { balance };
  },

  async getBalance(clientId: string, salonId: string): Promise<{ balance: number }> {
    const client = await clientsRepository.findById(clientId, salonId);
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");
    const balance = await ewalletRepository.getBalance(clientId);
    return { balance };
  },

  async listLedger(clientId: string, salonId: string, limit?: number): Promise<EwalletLedgerEntry[]> {
    const client = await clientsRepository.findById(clientId, salonId);
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");
    return ewalletRepository.listLedger(clientId, limit);
  },

  async getBreakdown(clientId: string, salonId: string): Promise<WalletBreakdown> {
    const client = await clientsRepository.findById(clientId, salonId);
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

    const [ledgerAgg, balance] = await Promise.all([
      ewalletRepository.getLedgerAggregate(clientId),
      ewalletRepository.getBalance(clientId),
    ]);

    return {
      referral_rewards: ledgerAgg.referral_rewards,
      reward_credits: ledgerAgg.reward_credits,
      other_credits: ledgerAgg.other_credits,
      wallet_debits: ledgerAgg.wallet_debits,
      balance,
    };
  },
};
