import { Request, Response, NextFunction } from 'express';
type AuthRequest = Request & {
    user?: {
        userId: string;
        salonId?: string;
        role?: string;
    };
};
export declare const dashboardController: {
    getStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=dashboard.controller.d.ts.map