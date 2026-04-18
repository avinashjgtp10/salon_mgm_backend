import { Request, Response, NextFunction } from 'express';
type AuthRequest = Request & {
    user?: {
        userId: string;
        salonId?: string;
        role?: string;
    };
};
export declare const configController: {
    getConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    saveConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    testConnection(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=config.controller.d.ts.map