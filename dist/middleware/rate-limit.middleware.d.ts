export declare function makeLoginLimitKey(email: string, ip: string): string;
/**
 * Middleware: check if user is blocked BEFORE running login logic
 * Put this before controller in /login route.
 */
export declare function loginRateLimitCheck(req: any, res: any, next: any): Promise<any>;
/**
 * Call this ONLY when password is WRONG
 */
export declare function recordLoginFail(email: string, ip: string): Promise<import("rate-limiter-flexible").RateLimiterRes>;
/**
 * Call this when login is SUCCESS
 */
export declare function resetLoginFails(email: string, ip: string): Promise<boolean>;
//# sourceMappingURL=rate-limit.middleware.d.ts.map