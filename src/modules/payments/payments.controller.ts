import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { paymentsService } from './payments.service';
import { CreatePaymentBody } from './payments.types';

type AuthRequest = Request & { user?: { userId: string; role?: string } };

export const paymentsController = {

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');

      const body = req.body as CreatePaymentBody;
      if (!body.salon_id)
        throw new AppError(400, 'salon_id is required', 'VALIDATION_ERROR');
      if (typeof body.gross_amount !== 'number' || body.gross_amount < 0)
        throw new AppError(400, 'gross_amount must be a non-negative number', 'VALIDATION_ERROR');
      if (typeof body.net_amount !== 'number' || body.net_amount < 0)
        throw new AppError(400, 'net_amount must be a non-negative number', 'VALIDATION_ERROR');
      if (!body.payment_method)
        throw new AppError(400, 'payment_method is required', 'VALIDATION_ERROR');

      const payment = await paymentsService.create(body);
      return sendSuccess(res, 201, payment, 'Payment recorded successfully');
    } catch (err) { return next(err); }
  },

  async getByAppointmentId(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.appointmentId || '').trim();
      if (!id) throw new AppError(400, 'appointmentId is required', 'VALIDATION_ERROR');
      const payment = await paymentsService.getByAppointmentId(id);
      return sendSuccess(res, 200, payment, 'Payment fetched successfully');
    } catch (err) { return next(err); }
  },

  async listBySalon(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = String(req.query.salon_id || '').trim();
      if (!salonId) throw new AppError(400, 'salon_id query param is required', 'VALIDATION_ERROR');
      const payments = await paymentsService.listBySalon(salonId);
      return sendSuccess(res, 200, payments, 'Payments fetched successfully');
    } catch (err) { return next(err); }
  },
};
