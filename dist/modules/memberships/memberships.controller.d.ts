import { NextFunction, Request, Response } from "express";
export declare const membershipsController: {
    list(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    create(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getById(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    update(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    delete(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
//# sourceMappingURL=memberships.controller.d.ts.map