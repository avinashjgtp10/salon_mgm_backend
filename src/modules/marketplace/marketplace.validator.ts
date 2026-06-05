import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';

export const validateCreateListing = (req: Request, _res: Response, next: NextFunction) => {
  const { display_name } = req.body;
  if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
    return next(new AppError(400, 'display_name is required', 'VALIDATION_ERROR'));
  }
  return next();
};

export const validateUpdateListing = (_req: Request, _res: Response, next: NextFunction) => {
  return next(); // all fields optional
};

export const validateCreateBooking = (req: Request, _res: Response, next: NextFunction) => {
  const { customer_phone} = req.body;
  const missing = ['listing_id', 'customer_name', 'customer_phone', 'service_name', 'booking_date', 'booking_time']
    .filter(k => !req.body[k]);
  if (missing.length > 0) {
    return next(new AppError(400, `Missing required fields: ${missing.join(', ')}`, 'VALIDATION_ERROR'));
  }
  if (!/^\d{10,15}$/.test(String(customer_phone).replace(/[+\s-]/g, ''))) {
    return next(new AppError(400, 'Invalid phone number', 'VALIDATION_ERROR'));
  }
  return next();
};

export const validateCreateReview = (req: Request, _res: Response, next: NextFunction) => {
  const { listing_id, customer_phone, rating } = req.body;
  if (!listing_id || !customer_phone) {
    return next(new AppError(400, 'listing_id and customer_phone are required', 'VALIDATION_ERROR'));
  }
  const r = Number(rating);
  if (isNaN(r) || r < 1 || r > 5) {
    return next(new AppError(400, 'rating must be between 1 and 5', 'VALIDATION_ERROR'));
  }
  return next();
};