import { Request, Response, NextFunction } from "express";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { staffHasPermission, type PermUser } from "../../middleware/permission.middleware";
import { mobileCalendarAccessGrants } from "../mobile-staff/mobileCalendarAccess";
import { sendSuccess } from "../utils/response.util";
import { categoriesService } from "../categories/categories.service";
import { suppliersService } from "../inventory/inventory.service";
import { consumableInventoryService } from "../inventory/consumable-inventory.service";
import { branchesService } from "../branches/branches.service";
import { productsService, brandsService } from "./products.service";
import { parseSearchFilters } from "./products.controller";

// Two screens, two requests:
//   POST /products/list-view   -> Catalog > Products list (rows + the dropdown lookups it needs)
//   GET  /products/product-list   -> Add / Edit Product form (every dropdown + the product when editing)
// Each used to be five or six separate calls (list, brands, categories, suppliers, branches,
// services, product, consumable detail). The lookups are the exact same rows those endpoints
// return, and each one is only included when the caller holds the permission that endpoint
// already required, so nothing is exposed that was not already reachable.

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

// Same rule requireAnyPermission() applies: owner/admin always pass, staff need one of the keys.
async function canAny(req: AuthRequest, keys: string[]): Promise<boolean> {
    const user = req.user as PermUser | undefined;
    if (!user?.userId) return false;
    if (user.role === "salon_owner" || user.role === "admin") return true;
    if (user.role !== "staff") return true;
    for (const key of keys) {
        if (await staffHasPermission(user, key)) return true;
    }
    return mobileCalendarAccessGrants(req as any, keys);
}

// Gates mirror the route each lookup used to come from.
const PERMS = {
    brands:     ["manage_my_brands", "view_products", "create_sales", "manage_calendar"],
    categories: ["view_services", "create_sales", "manage_calendar"],
    suppliers:  ["view_suppliers"],
    branches:   ["view_branches", "stock_ledger_adjustment", "edit_stock_ledger", "create_product_audit"],
};

type Want = { brands?: boolean; categories?: boolean; suppliers?: boolean; branches?: boolean; services?: boolean };

// A lookup the caller may not see comes back as null (not an error), so one missing
// permission never blocks the page - same as before, where only that one call failed.
async function loadLookups(req: AuthRequest, salonId: string, want: Want) {
    const gated = async <T>(on: boolean | undefined, keys: string[] | null, load: () => Promise<T>): Promise<T | null> => {
        if (!on) return null;
        if (keys && !(await canAny(req, keys))) return null;
        try {
            return await load();
        } catch (err) {
            logger.warn("products bootstrap lookup failed", { err: (err as Error)?.message });
            return null;
        }
    };
    const [brands, categories, suppliers, branches, services] = await Promise.all([
        gated(want.brands, PERMS.brands, () => brandsService.list(salonId)),
        gated(want.categories, PERMS.categories, () => categoriesService.listMySalonCategories({ salonId })),
        // page_limit 100 is what the dropdowns always asked for.
        gated(want.suppliers, PERMS.suppliers, () => suppliersService.listPaginated(salonId, 1, 100)),
        gated(want.branches, PERMS.branches, () => branchesService.listBranchesBySalon(salonId)),
        // Active services (id + name) for the consumable "used in services" picker.
        gated(want.services, PERMS.categories, async () => {
            const { rows } = await pool.query(
                `SELECT id, name FROM services WHERE salon_id = $1 AND is_active = true ORDER BY name ASC LIMIT 500`,
                [salonId],
            );
            return rows;
        }),
    ]);
    return { brands, categories, suppliers, branches, services };
}

export const productsBootstrapController = {
    // POST /api/v1/products/list-view
    // Body = the same filters/paging POST /products/search takes, plus `include_lookups: true`
    // on the first load only (brands, categories, suppliers, branches). Filter, search and page
    // changes afterwards send the same request without it and get just the rows.
    async listView(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const { page, limit, pageSize, include_lookups } = req.body ?? {};
            const resolvedLimit = pageSize !== undefined ? Number(pageSize) : limit !== undefined ? Number(limit) : undefined;
            const list = await productsService.list({
                requesterUserId: req.user?.userId ?? "anonymous",
                requesterRole: req.user?.role,
                salonId,
                filters: {
                    ...parseSearchFilters(req),
                    page: page !== undefined ? Number(page) : undefined,
                    limit: resolvedLimit,
                },
            });
            const lookups = include_lookups
                ? await loadLookups(req, salonId, { brands: true, categories: true, suppliers: true, branches: true })
                : undefined;
            return sendSuccess(res, 200, { list, lookups }, "Products fetched successfully");
        } catch (err) {
            logger.error("POST /products/list-view error", { err });
            return next(err);
        }
    },

    // GET /api/v1/products/product-list[?id=<productId>]
    async formData(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
            const [lookups, product] = await Promise.all([
                loadLookups(req, salonId, { brands: true, categories: true, suppliers: true, services: true }),
                id ? productsService.getById(id, salonId) : Promise.resolve(null),
            ]);
            // Consumable stock / usage / assigned-services / unit-conversions detail only exists for
            // consumable or "both" products, so it is read once the product type is known.
            const isConsumable = !!product && (product.product_type === "consumable" || product.product_type === "both");
            const consumable = isConsumable ? await consumableInventoryService.getById(id, salonId) : null;
            return sendSuccess(res, 200, { ...lookups, product, consumable }, "Product form data fetched successfully");
        } catch (err) {
            logger.error("GET /products/product-list error", { err });
            return next(err);
        }
    },
};
