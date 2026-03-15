import { Request, Response, NextFunction } from "express";
type AuthRequest = Request & {
    user?: {
        userId: string;
        role?: string;
    };
};
export declare const billingController: {
    listPlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    getPlanById(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    getSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    subscribe(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    updateSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    cancelSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    listInvoices(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
    getInvoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
};
export {};
//# sourceMappingURL=billing.controller.d.ts.map