import { z } from "zod";
import { Request, Response, NextFunction } from "express";
/**
 * REGISTER VALIDATION
 */
export declare const validateRegister: (req: Request, _res: Response, next: NextFunction) => void;
/**
 * LOGIN VALIDATION
 */
export declare const validateLogin: (req: Request, _res: Response, next: NextFunction) => void;
/**
 * REFRESH TOKEN VALIDATION
 */
export declare const validateRefresh: (req: Request, _res: Response, next: NextFunction) => void;
export declare const googleCallbackQuerySchema: z.ZodObject<{
    code: z.ZodString;
    state: z.ZodString;
}, z.core.$strip>;
export declare const googleStartQuerySchema: z.ZodObject<{
    returnTo: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
//# sourceMappingURL=auth.validator.d.ts.map