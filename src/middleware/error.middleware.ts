import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from '../config/logger';

export class AppError extends Error {
  statusCode: number;
  code?: string;
  details?: any;

  constructor(statusCode: number, message: string, code?: string, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    logger.error(`AppError: ${err.message}`, {
      code: err.code,
      statusCode: err.statusCode,
      url: req.url,
      method: req.method,
    });

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code || 'ERROR',
        message: err.message,
        details: err.details,
      },
    });
  }

  // Multer file-upload errors (e.g. file exceeds the configured size limit)
  if (err instanceof multer.MulterError) {
    logger.warn(`MulterError: ${err.message}`, { code: err.code, url: req.url, method: req.method });
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large.'
      : err.message;
    return res.status(400).json({
      success: false,
      error: { code: err.code, message },
    });
  }

  // Postgres unique-constraint violation (code 23505). This is a fallback
  // for races the app's own pre-checks (e.g. couponsRepository.findByCodeOwn)
  // didn't catch — most requests never reach here at all. `table` is
  // populated by Postgres the same way it is for the FK-violation branch
  // below, so the message can name the right entity instead of assuming
  // every unique violation in the whole app is about a client (it used to,
  // hardcoded, which mislabelled e.g. a duplicate coupon code as a
  // duplicate client).
  if ((err as any).code === '23505') {
    const table: string | undefined = (err as any).table;
    const detail: string = (err as any).detail || '';
    logger.warn(`Duplicate key error: ${err.message}`, { url: req.url, method: req.method, table });
    const FRIENDLY_ENTITY_NAMES: Record<string, string> = {
      clients: 'client',
      coupons: 'coupon',
      services: 'service',
      products: 'product',
      staff: 'staff member',
    };
    const entity = (table && FRIENDLY_ENTITY_NAMES[table]) || 'record';
    let message = `A ${entity} with this value already exists.`;
    if (detail.includes('email')) message = `A ${entity} with this email address already exists.`;
    else if (detail.includes('phone_number')) message = `A ${entity} with this phone number already exists.`;
    else if (table === 'coupons' && detail.includes('code')) message = 'A coupon with this code already exists for this salon.';
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message,
      },
    });
  }

  // Postgres foreign-key violation (code 23503) — hit when deleting (or
  // updating the referenced key of) a row something else still points to
  // via an ON DELETE RESTRICT/NO ACTION constraint, e.g. deleting a Service
  // that's still attached to a Bundle or a client's purchased package.
  // err.table is the constraint's own (referencing) table, not the one the
  // DELETE targeted.
  if ((err as any).code === '23503') {
    logger.warn(`Foreign key violation: ${err.message}`, {
      table: (err as any).table,
      constraint: (err as any).constraint,
      url: req.url,
      method: req.method,
    });
    const FRIENDLY_TABLE_NAMES: Record<string, string> = {
      bundle_services: 'one or more bundles',
      client_package_services: 'one or more client packages',
    };
    const referencingTable = (err as any).table as string | undefined;
    const friendly = referencingTable ? FRIENDLY_TABLE_NAMES[referencingTable] : undefined;
    return res.status(409).json({
      success: false,
      error: {
        code: 'REFERENCED_ELSEWHERE',
        message: friendly
          ? `This can't be deleted — it's still in use by ${friendly}. Remove it from there first.`
          : "This can't be deleted because other records still depend on it.",
      },
    });
  }

  logger.error(`Unhandled error: ${err.message}`, {
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong',
    },
  });
};
