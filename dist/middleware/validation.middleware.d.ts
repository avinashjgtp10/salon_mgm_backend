import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
export declare const validateBody: (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=validation.middleware.d.ts.map