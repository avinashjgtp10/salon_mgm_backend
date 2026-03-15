import { Request, Response, NextFunction } from "express";
export type Role = "admin" | "salon_owner" | "staff" | "client";
export type AuthRequest = Request & {
    user?: {
        userId: string;
        role?: Role | string;
    };
};
export declare const roleMiddleware: (...allowedRoles: Role[]) => (req: AuthRequest, _res: Response, next: NextFunction) => void;
export declare const protect: (...allowedRoles: Role[]) => (req: AuthRequest, _res: Response, next: NextFunction) => void;
//# sourceMappingURL=role.middleware.d.ts.map