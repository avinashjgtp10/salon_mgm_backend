import { z } from "zod";

export const updateProfileBodySchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50).optional(),
  lastName: z.string().trim().max(50).nullable().optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number format")
    .nullable()
    .optional(),
  businessName: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  countryCode: z.string().trim().max(10).nullable().optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
