import { describePaymentMethod } from "./payment-method-label";
import { translator } from "../../config/i18n";

const en = translator("en");

describe("describePaymentMethod", () => {
    it.each([
        ["cash", "Cash"],
        ["card", "Card"],
        ["upi", "UPI"],
        ["wallet", "E-Wallet"],
        ["gift_card", "Gift Card"],
        ["package", "Package"],
        ["membership", "Membership"],
        ["pos_machine", "Payment Machine"],
        ["online", "Online Payment"],
        ["razorpay", "Online Payment"],
    ])("shows %s as %s", (code, label) => {
        expect(describePaymentMethod(code, null, en, "INR")).toBe(label);
    });

    it("is case-insensitive and trims", () => {
        expect(describePaymentMethod("  UPI ", null, en)).toBe("UPI");
        expect(describePaymentMethod("Cash", null, en)).toBe("Cash");
    });

    it("prints a salon's own payment method exactly as the salon named it", () => {
        expect(describePaymentMethod("Paytm Wallet", null, en)).toBe("Paytm Wallet");
    });

    it("returns an empty string when nothing is recorded, so the caller can choose a fallback", () => {
        expect(describePaymentMethod(null, null, en)).toBe("");
        expect(describePaymentMethod(undefined, null, en)).toBe("");
        expect(describePaymentMethod("   ", null, en)).toBe("");
    });

    it("breaks a split bill into its parts with the amounts", () => {
        const text = describePaymentMethod("split", JSON.stringify({ cash: 1000, upi: 1500 }), en, "INR");
        expect(text).toBe("Split: Cash ₹1,000.00 + UPI ₹1,500.00");
    });

    it("ignores zero-amount legs of a split", () => {
        expect(describePaymentMethod("split", JSON.stringify({ cash: 0, card: 800 }), en, "INR")).toBe("Split: Card ₹800.00");
    });

    it("falls back to plain 'Split' when there is no usable breakdown", () => {
        expect(describePaymentMethod("split", null, en)).toBe("Split");
        expect(describePaymentMethod("split", "not json", en)).toBe("Split");
        expect(describePaymentMethod("split", JSON.stringify({}), en)).toBe("Split");
    });

    it("does not treat a transaction reference on a normal sale as a breakdown", () => {
        expect(describePaymentMethod("upi", "UPI-20261124-123456", en)).toBe("UPI");
    });

    it("uses the salon's language where a translation exists (Hindi cash)", () => {
        const hi = translator("hi");
        expect(describePaymentMethod("cash", null, hi)).toBe(hi("receipt.method.cash"));
        expect(describePaymentMethod("cash", null, hi)).not.toBe("receipt.method.cash");
    });
});
