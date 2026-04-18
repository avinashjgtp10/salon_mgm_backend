import { Request, Response, NextFunction } from 'express';
type AuthRequest = Request & {
    user?: {
        userId: string;
        salonId?: string;
        role?: string;
    };
};
export declare const webhooksController: {
    verify(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    handle(req: Request, res: Response, next: NextFunction): Promise<void>;
    getEvents(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=webhooks.controller.d.ts.map