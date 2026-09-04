import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { getSalonId } from '../utils/tenant.util';
import { posPaymentsService } from './pos-payments.service';
import { PosProviderId } from './pos-payments.types';
import logger from '../../config/logger';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const posPaymentsController = {

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');

      const { appointment_id, branch_id, client_id, terminal_id, provider, amount, payload } = req.body;
      if (!appointment_id) throw new AppError(400, 'appointment_id is required', 'VALIDATION_ERROR');
      if (!provider) throw new AppError(400, 'provider is required', 'VALIDATION_ERROR');
      if (typeof amount !== 'number' || amount <= 0) throw new AppError(400, 'amount must be a positive number', 'VALIDATION_ERROR');
      if (!payload || typeof payload !== 'object') throw new AppError(400, 'payload is required', 'VALIDATION_ERROR');

      const request = await posPaymentsService.create({
        salonId, branchId: branch_id, appointmentId: appointment_id, clientId: client_id,
        terminalId: terminal_id, provider, amount, payload, requesterUserId: userId,
      });
      return sendSuccess(res, 201, request, 'Payment request created');
    } catch (err) { return next(err); }
  },

  async getStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || '').trim();
      const request = await posPaymentsService.getStatus(id, salonId);
      return sendSuccess(res, 200, request, 'Status fetched');
    } catch (err) { return next(err); }
  },

  async cancel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || '').trim();
      const request = await posPaymentsService.cancel(id, salonId);
      return sendSuccess(res, 200, request, 'Payment request cancelled');
    } catch (err) { return next(err); }
  },

  async confirmManual(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || '').trim();
      const { provider_transaction_id } = req.body;
      const request = await posPaymentsService.confirmManual(id, salonId, provider_transaction_id);
      return sendSuccess(res, 200, request, 'Payment confirmed');
    } catch (err) { return next(err); }
  },

  async listEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || '').trim();
      const events = await posPaymentsService.listEvents(id, salonId);
      return sendSuccess(res, 200, events, 'Audit history fetched');
    } catch (err) { return next(err); }
  },

  /**
   * Public route — no authMiddleware, a payment provider can't send a JWT.
   * Built as part of the provider abstraction for providers that do emit a
   * webhook; Paytm (this repo's only wired provider) doesn't use it today.
   * Always responds 200 so providers don't hammer retries, even on a
   * signature failure or an unmatched reference — everything meaningful is
   * logged via pos_payment_events instead of surfaced through the response.
   */
  async webhook(req: Request, res: Response) {
    const providerId = String(req.params.provider || '').trim() as PosProviderId;
    // Providers can't be given a JWT to send back — salon_id must travel in
    // the webhook payload itself (or query string), same as WhatsApp's
    // shared-secret webhook pattern elsewhere in this codebase.
    const salonId = String(req.body?.salon_id || req.query?.salon_id || '').trim();
    try {
      if (!salonId) {
        logger.warn('[pos-payments/webhook] no salon_id, ignoring', { providerId });
        return res.status(200).json({ received: true });
      }
      await posPaymentsService.handleWebhookEvent(providerId, salonId, req);
    } catch (err: any) {
      logger.error('[pos-payments/webhook] handler error', { providerId, message: err?.message });
    }
    // Always 200 — never give a provider a reason to hammer retries; every
    // meaningful outcome is already logged via pos_payment_events.
    return res.status(200).json({ received: true });
  },
};
