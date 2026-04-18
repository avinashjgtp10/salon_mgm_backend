import { Request, Response, NextFunction } from "express";
interface AuthRequest extends Request {
    user?: {
        userId: string;
        role?: string;
    };
}
export declare const profileController: {
    /**
     * GET /api/v1/profile/:id
     * Authenticated user can fetch own profile; admin can fetch any.
     */
    getProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * PUT /api/v1/profile/:id
     * Authenticated user can update own profile; admin can update any.
     * Body is pre-validated by validateBody(updateProfileBodySchema).
     */
    updateProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=profile.controller.d.ts.map