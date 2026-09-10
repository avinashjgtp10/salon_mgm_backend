import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { getSalonId } from '../utils/tenant.util';
import { paymentSettingsService } from './payment-settings.service';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const paymentSettingsController = {

  async listTerminals(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const terminals = await paymentSettingsService.listTerminals(salonId);
      return sendSuccess(res, 200, terminals, 'Terminals fetched successfully');
    } catch (err) { return next(err); }
  },

  async createTerminal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const terminal = await paymentSettingsService.createTerminal({ ...req.body, salon_id: salonId });
      return sendSuccess(res, 201, terminal, 'Terminal created successfully');
    } catch (err) { return next(err); }
  },

  async updateTerminal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const terminal = await paymentSettingsService.updateTerminal(id, salonId, req.body);
      return sendSuccess(res, 200, terminal, 'Terminal updated successfully');
    } catch (err) { return next(err); }
  },

  async deleteTerminal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      await paymentSettingsService.deleteTerminal(id, salonId);
      return sendSuccess(res, 200, null, 'Terminal deleted successfully');
    } catch (err) { return next(err); }
  },

  async listProviderConfigs(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const configs = await paymentSettingsService.listProviderConfigs(salonId);
      // Never echo stored credentials back to the client — the settings UI
      // only needs to know a provider is configured, not what the secrets are.
      const redacted = configs.map((c) => ({ ...c, credentials: c.credentials ? Object.keys(c.credentials).reduce((acc, k) => ({ ...acc, [k]: '••••••••' }), {}) : null }));
      return sendSuccess(res, 200, redacted, 'Provider configs fetched successfully');
    } catch (err) { return next(err); }
  },

  async upsertProviderConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const config = await paymentSettingsService.upsertProviderConfig({ ...req.body, salon_id: salonId });
      const redacted = { ...config, credentials: config.credentials ? Object.keys(config.credentials).reduce((acc, k) => ({ ...acc, [k]: '••••••••' }), {}) : null };
      return sendSuccess(res, 200, redacted, 'Provider configuration saved successfully');
    } catch (err) { return next(err); }
  },

  async testConnection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const provider = String(req.params.provider || '').trim();
      if (!provider) throw new AppError(400, 'provider is required', 'VALIDATION_ERROR');
      const result = await paymentSettingsService.testConnection(salonId, provider);
      return sendSuccess(res, 200, result, result.ok ? 'Connection test passed' : 'Connection test failed');
    } catch (err) { return next(err); }
  },
};
