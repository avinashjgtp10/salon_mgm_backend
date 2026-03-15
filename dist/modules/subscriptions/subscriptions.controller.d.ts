import { Request, Response, NextFunction } from "express";
type AuthRequest = Request & {
    user?: {
        userId: string;
        role?: string;
    };
};
export declare const subscriptionsController: {
    createPlan(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    listPlans(_req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getPlan(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    startTrial(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getTrialStatus(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    createSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getSubscriptionsBySalon(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getSubscription(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    cancelSubscription(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getPayments(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    webhook(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=subscriptions.controller.d.ts.map