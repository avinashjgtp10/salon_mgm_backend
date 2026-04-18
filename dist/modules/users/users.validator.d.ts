import { z } from "zod";
/**
 * Registration Schema
 * NOTE: Admin is NOT allowed in public registration
 */
export declare const registerSchema: z.ZodObject<{
    email: z.ZodString;
    phone: z.ZodOptional<z.ZodString>;
    password: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodOptional<z.ZodString>;
    role: z.ZodEnum<{
        salon_owner: "salon_owner";
        staff: "staff";
        client: "client";
    }>;
}, z.core.$strip>;
/**
 * Login Schema
 */
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
/**
 * Refresh Token Schema
 */
export declare const refreshSchema: z.ZodObject<{
    refreshToken: z.ZodString;
}, z.core.$strip>;
/**
 * Update User Schema
 */
export declare const updateUserSchema: z.ZodObject<{
    body: z.ZodObject<{
        firstName: z.ZodOptional<z.ZodString>;
        lastName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        phone: z.ZodOptional<z.ZodString>;
        avatarUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        isActive: z.ZodOptional<z.ZodBoolean>;
        role: z.ZodOptional<z.ZodEnum<{
            salon_owner: "salon_owner";
            staff: "staff";
            client: "client";
            admin: "admin";
        }>>;
        businessName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        countryCode: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * Change Password Schema (authenticated user)
 */
export declare const changePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, z.core.$strip>;
/**
 * Type inference
 */
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>["body"];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
//# sourceMappingURL=users.validator.d.ts.map