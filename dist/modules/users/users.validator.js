"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserSchema = exports.refreshSchema = exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
/**
 * Common reusable fields
 */
const emailSchema = zod_1.z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email format");
const passwordSchema = zod_1.z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");
const phoneSchema = zod_1.z
    .string()
    .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number format")
    .optional();
/**
 * Registration Schema
 * NOTE: Admin is NOT allowed in public registration
 */
exports.registerSchema = zod_1.z.object({
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    firstName: zod_1.z.string().trim().min(1, "First name is required").max(50),
    lastName: zod_1.z.string().trim().max(50).optional(),
    role: zod_1.z.enum(["salon_owner", "staff", "client"]),
});
/**
 * Login Schema
 */
exports.loginSchema = zod_1.z.object({
    email: emailSchema,
    password: zod_1.z.string().min(1, "Password is required"),
});
/**
 * Refresh Token Schema
 */
exports.refreshSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1, "Refresh token is required"),
});
/**
 * Update User Schema
 */
exports.updateUserSchema = zod_1.z.object({
    body: zod_1.z.object({
        firstName: zod_1.z.string().trim().min(1).max(50).optional(),
        lastName: zod_1.z.string().trim().max(50).optional(),
        phone: phoneSchema,
        avatarUrl: zod_1.z.string().url().optional().nullable(),
        isActive: zod_1.z.boolean().optional(),
        role: zod_1.z.enum(["salon_owner", "staff", "client", "admin"]).optional(),
    }),
});
//# sourceMappingURL=users.validator.js.map