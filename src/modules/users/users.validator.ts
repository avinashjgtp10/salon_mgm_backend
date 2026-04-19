import { z } from "zod";

/**
 * Common reusable fields
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email format");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character",
  );

const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number format")
  .optional();

/**
 * Registration Schema
 * NOTE: Admin is NOT allowed in public registration
 */
export const registerSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName: z.string().trim().max(50).optional(),
  role: z.enum(["salon_owner", "staff", "client"]),
});

/**
 * Login Schema
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Refresh Token Schema
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

/**
 * Update User Schema
 */
export const updateUserSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(1).max(50).optional(),
    lastName: z.string().trim().max(50).optional().nullable(),
    phone: phoneSchema,
    avatarUrl: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
    role: z.enum(["salon_owner", "staff", "client", "admin"]).optional(),
    // Profile fields
    businessName: z.string().trim().max(255).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
    countryCode: z.string().trim().max(10).optional().nullable(),
  }),
});

/**
 * Change Password Schema (authenticated user)
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number"),
});

/**
 * Type inference
 */
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>["body"];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
