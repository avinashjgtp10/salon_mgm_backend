import { Request, Response, NextFunction } from "express";
type AuthRequest = Request & {
    user?: {
        userId: string;
        role?: string;
    };
};
export declare const categoriesController: {
    create(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    update(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=categories.controller.d.ts.map