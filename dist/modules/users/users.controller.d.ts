import { Request, Response, NextFunction } from "express";
interface AuthRequest extends Request {
    user?: {
        userId: string;
        role?: string;
    };
}
export declare const usersController: {
    /**
     * GET /api/v1/users/me
     * Protected
     */
    me(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * GET /api/v1/users
     * Protected (admin in your route middleware)
     */
    list(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
 * PATCH /api/v1/users/:id/role
 * Protected (admin only in routes)
 */
    updateRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * GET /api/v1/users/:id
     * Protected
     */
    getById(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * PATCH /api/v1/users/:id
     * Protected
     */
    update(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * DELETE /api/v1/users/:id
     * Protected
     */
    remove(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * PATCH /api/v1/users/me
     * The authenticated user updates their own profile
     */
    updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * POST /api/v1/users/me/change-password
     * Authenticated user changes their own password.
     */
    changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /**
     * POST /api/v1/users/me/avatar
     * Upload profile picture — file processed by multer, then stored to S3 (or local)
     */
    uploadAvatar(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=users.controller.d.ts.map