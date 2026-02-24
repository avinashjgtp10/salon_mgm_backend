import { Response } from "express";
import { randomUUID } from "crypto";

/**
 * Success Response Interface
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
  message?: string;
  meta: {
    timestamp: string;
    requestId: string;
  };
}

/**
 * Error Response Interface
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any[];
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}

/**
 * Generate Meta Info
 */
const createMeta = () => ({
  timestamp: new Date().toISOString(),
  requestId: randomUUID(), // unique request tracking
});

/**
 * Success Response
 */
export const sendSuccess = <T>(
  res: Response,
  statusCode: number,
  data: T,
  message?: string,
) => {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
    meta: createMeta(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Error Response
 */
export const sendError = (
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: any[],
) => {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: createMeta(),
  };

  return res.status(statusCode).json(response);
};
