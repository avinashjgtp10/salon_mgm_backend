import { Request, Response, NextFunction } from "express";
export declare const authController: {
    register(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    login(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    refresh(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    logout(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    sendEmailOtp(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    verifyEmailOtp(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    sendPhoneOtpExotel(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    verifyPhoneOtpExotel(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    googleStart(req: Request, res: Response, next: NextFunction): Promise<void>;
    googleCallback(req: Request, res: Response, _next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
//# sourceMappingURL=auth.controller.d.ts.map