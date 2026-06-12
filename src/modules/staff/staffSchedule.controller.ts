import { Request, Response } from 'express';
import { staffSchedulesService } from './staff.service';
import { sendSuccess, sendError } from '../utils/response.util';

export const deleteSingleShift = async (req: Request, res: Response) => {
  const { staffId } = req.params;
  const { date, salon_id } = req.body as { date: string; salon_id: string };

  if (!date) {
    return sendError(res, 400, 'MISSING_DATE', 'Date is required');
  }
  if (!salon_id) {
    return sendError(res, 400, 'MISSING_SALON', 'salon_id is required');
  }

  try {
    await staffSchedulesService.deleteByDate(staffId, salon_id, date);
    return sendSuccess(res, 200, null, 'Schedule deleted');
  } catch (err) {
    console.error('Delete schedule error', err);
    return sendError(res, 500, 'DELETE_FAILED', 'Failed to delete schedule');
  }
};
