"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfileBodySchema = void 0;
const zod_1 = require("zod");
exports.updateProfileBodySchema = zod_1.z.object({
    firstName: zod_1.z.string().trim().min(1, "First name is required").max(50).optional(),
    lastName: zod_1.z.string().trim().max(50).nullable().optional(),
    phone: zod_1.z
        .string()
        .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number format")
        .nullable()
        .optional(),
    businessName: zod_1.z.string().trim().max(255).nullable().optional(),
    address: zod_1.z.string().trim().max(500).nullable().optional(),
    country: zod_1.z.string().trim().max(100).nullable().optional(),
    countryCode: zod_1.z.string().trim().max(10).nullable().optional(),
});
//# sourceMappingURL=profile.validator.js.map