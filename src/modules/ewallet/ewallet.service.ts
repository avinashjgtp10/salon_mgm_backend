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

  // Manual correction to the wallet balance itself — e.g. staff topped up
  // the wrong amount and needs to reverse/reduce it, without inventing a
  // fake "negative topup" or losing the record of what happened. Both
  // directions go through the ledger (applyLedgerEntry), so the correction
  // is fully auditable alongside every other credit/debit on this wallet —
  // never a silent balance overwrite.
  async adjust(
    clientId: string,
    salonId: string,
    direction: "credit" | "debit",
    amount: number,
    reason: string,
    createdBy: string,
  ): Promise<{ balance: number }> {
    if (!isFinite(amount) || amount <= 0) {
      throw new AppError(400, "amount must be a positive number", "VALIDATION_ERROR");
    }
    if (direction !== "credit" && direction !== "debit") {
      throw new AppError(400, "direction must be 'credit' or 'debit'", "VALIDATION_ERROR");
    }
    if (!reason || !reason.trim()) {
      throw new AppError(400, "reason is required for a wallet adjustment", "VALIDATION_ERROR");
    }
    const client = await clientsRepository.findById(clientId, salonId);
    if (!client) throw new AppError(404, "Client not found", "NOT_FOUND");

    if (direction === "debit") {
      const currentBalance = await ewalletRepository.getBalance(clientId);
      if (amount > currentBalance) {
        throw new AppError(
          400,
          `Debit amount (₹${amount}) exceeds the client's available wallet balance (₹${currentBalance})`,
          "VALIDATION_ERROR",
        );
      }
    }

    const delta = direction === "debit" ? -amount : amount;
    const balance = await ewalletRepository.applyLedgerEntry({
      clientId,
      salonId,
      type: "adjust",
      delta,
      sourceType: "manual_adjustment",
      note: reason.trim(),
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
