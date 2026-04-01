import { Request, Response, NextFunction } from 'express';
export declare const webhooksController: {
    verify(req: Request, res: Response, next: NextFunction): Promise<void>;
    handle(req: Request, res: Response, next: NextFunction): Promise<void>;
    getEvents(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
};
//# sourceMappingURL=webhooks.controller.d.ts.map