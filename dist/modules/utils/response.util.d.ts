import { Response } from "express";
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
 * Success Response
 */
export declare const sendSuccess: <T>(res: Response, statusCode: number, data: T, message?: string) => Response<any, Record<string, any>>;
/**
 * Error Response
 */
export declare const sendError: (res: Response, statusCode: number, code: string, message: string, details?: any[]) => Response<any, Record<string, any>>;
//# sourceMappingURL=response.util.d.ts.map