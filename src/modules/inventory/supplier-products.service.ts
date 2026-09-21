import { AppError } from "../../middleware/error.middleware";
import { supplierProductsRepository } from "./supplier-products.repository";
import { supplierProductsImportService } from "./supplier-products.import.service";
import { productsRepository } from "../products/products.repository";
import {
    SupplierProduct, ListSupplierProductsFilters, ResolveSupplierProductBody,
    SupplierProductImportResult,
} from "./supplier-products.types";

export const supplierProductsService = {
    async list(supplierId: string, salonId: string, filters: ListSupplierProductsFilters): Promise<SupplierProduct[]> {
        return supplierProductsRepository.list(supplierId, salonId, filters);
    },

    async import(params: { supplierId: string; salonId: string; file: Buffer; filename: string }): Promise<SupplierProductImportResult> {
        return supplierProductsImportService.importCatalog(params);
    },

    // Three resolve actions for a still-unmatched catalog row:
    // - link: attach a caller-chosen EXISTING product.
    // - create_product: create a minimal product from exactly this row's own
    //   name/barcode/brand/category/price/hsn — nothing invented, same "ask
    //   before creating" rule the import itself follows.
    // - ignore: hide it from Suggested Products without resolving anything.
    async resolve(params: {
        catalogId: string; salonId: string; body: ResolveSupplierProductBody;
    }): Promise<SupplierProduct> {
        const { catalogId, salonId, body } = params;
        const row = await supplierProductsRepository.getById(catalogId, salonId);
        if (!row) throw new AppError(404, "Catalog row not found", "SUPPLIER_PRODUCT_NOT_FOUND");

        if (body.action === "link") {
            if (!body.product_id) throw new AppError(400, "product_id is required for action=link", "VALIDATION_ERROR");
            const product = await productsRepository.findById(body.product_id, salonId);
            if (!product) throw new AppError(404, "product_id does not belong to this salon", "PRODUCT_NOT_FOUND");
            const updated = await supplierProductsRepository.resolve(catalogId, salonId, "link", body.product_id);
            return updated!;
        }

        if (body.action === "create_product") {
            const created = await productsRepository.create({
                name: row.name,
                barcode: row.barcode || undefined,
                brand_id: row.brand_id || undefined,
                category_id: row.category_id || undefined,
                supplier_id: row.supplier_id,
                supply_price: row.price ?? undefined,
                hsn_sac: row.hsn_sac || undefined,
            }, salonId);
            const updated = await supplierProductsRepository.resolve(catalogId, salonId, "create_product", created.id);
            return updated!;
        }

        // ignore
        const updated = await supplierProductsRepository.resolve(catalogId, salonId, "ignore", null);
        return updated!;
    },
};
