import { AppError } from "../../middleware/error.middleware";
import { orderReceiptsRepository } from "./order-receipts.repository";
import { ordersRepository } from "./orders.repository";
import { OrderReceiptWithItems, UpsertReceiptBody, ConfirmReceiptBody } from "./order-receipts.types";
import { Order } from "./orders.types";

function assertDraft(receipt: OrderReceiptWithItems) {
    if (receipt.status !== "draft") {
        throw new AppError(409, "This receipt has already been confirmed", "RECEIPT_ALREADY_CONFIRMED");
    }
}

async function getOwned(receiptId: string, salonId: string): Promise<OrderReceiptWithItems> {
    const receipt = await orderReceiptsRepository.getById(receiptId, salonId);
    if (!receipt) throw new AppError(404, "Receipt not found", "RECEIPT_NOT_FOUND");
    return receipt;
}

export const orderReceiptsService = {
    // Fetches the order's open draft receipt, creating one (seeded from
    // order_items' current cumulative totals) if none exists yet — the
    // Receiving tab always has exactly one working session per order.
    async getOrCreateDraft(params: { orderId: string; salonId: string; createdBy: string }): Promise<OrderReceiptWithItems> {
        const { orderId, salonId, createdBy } = params;
        const order = await ordersRepository.getById(orderId, salonId);
        if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
        if (order.status === "cancelled") throw new AppError(400, "Cannot receive against a cancelled order", "ORDER_CANCELLED");
        if (order.status === "received") throw new AppError(400, "Order is already fully received", "ORDER_ALREADY_RECEIVED");

        return orderReceiptsRepository.getOrCreateDraft(orderId, salonId, createdBy);
    },

    // Save Draft — updates location/staff header fields (if provided) and
    // every line's Confirmed/Damaged targets in one call. No stock effect.
    async saveDraft(params: {
        receiptId: string; salonId: string;
        body: UpsertReceiptBody;
    }): Promise<OrderReceiptWithItems> {
        const { receiptId, salonId, body } = params;
        const receipt = await getOwned(receiptId, salonId);
        assertDraft(receipt);

        if (body.branch_id !== undefined || body.received_by !== undefined) {
            await orderReceiptsRepository.updateHeader(receiptId, salonId, {
                branch_id: body.branch_id, received_by: body.received_by,
            });
        }

        if (body.items?.length) {
            const itemIds = new Set(receipt.items.map((i) => i.order_item_id));
            for (const it of body.items) {
                if (!itemIds.has(it.order_item_id)) {
                    throw new AppError(404, "Order item not found on this receipt", "RECEIPT_ITEM_NOT_FOUND");
                }
                if (!Number.isFinite(it.confirmed_qty) || it.confirmed_qty < 0) {
                    throw new AppError(400, "confirmed_qty must be a non-negative number", "VALIDATION_ERROR");
                }
                if (!Number.isFinite(it.damaged_qty) || it.damaged_qty < 0) {
                    throw new AppError(400, "damaged_qty must be a non-negative number", "VALIDATION_ERROR");
                }
            }
            await orderReceiptsRepository.upsertItems(receiptId, body.items);
        }

        return getOwned(receiptId, salonId);
    },

    // Confirm Receiving — the one moment stock actually moves. Requires a
    // Receiving Location and Received By to already be set (via saveDraft),
    // matching the mockup's "only Confirm Receiving changes inventory" rule.
    async confirm(params: { receiptId: string; salonId: string; confirmedBy: string; body: ConfirmReceiptBody }): Promise<{ order: Order; receipt: OrderReceiptWithItems }> {
        const { receiptId, salonId, confirmedBy, body } = params;
        const { order, receipt } = await orderReceiptsRepository.confirmReceipt(receiptId, salonId, confirmedBy, body.purchase_date);
        return { order, receipt: await getOwned(receipt.id, salonId) };
    },
};
