import { buildStaffNotificationContent, StaffAppointmentRow } from "./staffNotificationContent";
import { translator } from "../../config/i18n";

const row = (over: Partial<StaffAppointmentRow> = {}): StaffAppointmentRow => ({
    user_id: "u1", staff_id: "s1", appointment_staff_id: "s1", client_name: "Meera Rao", invoice_number: "12", status: "booked",
    service_name: "Haircut", services: [{ staff_id: "s1", name: "Cut" }, { staff_id: "s1", name: "Colour" }], ...over,
});

describe("staff appointment notification text", () => {
    it("is unchanged in English (also the default when no translator is given)", () => {
        const expected = [{ userId: "u1", title: "INV-00012 · booked", body: "Me******* — Cut, Colour" }];
        expect(buildStaffNotificationContent([row()])).toEqual(expected);
        expect(buildStaffNotificationContent([row()], translator("en"))).toEqual(expected);
    });

    it("falls back to English words for a walk-in with no invoice yet", () => {
        const [n] = buildStaffNotificationContent([row({ client_name: null, invoice_number: null, services: [{ staff_id: "s1" }] })]);
        expect(n.title).toBe("Invoice not generated · booked");
        expect(n.body).toBe("Wa***** — Service");
    });

    it("speaks Arabic and Hindi, keeping the client's own letters and the service names", () => {
        const [ar] = buildStaffNotificationContent([row({ client_name: null, invoice_number: null })], translator("ar"));
        expect(ar.title).toBe("لم تُصدر فاتورة · محجوز");
        expect(ar.body).toContain("Cut, Colour");
        const [hi] = buildStaffNotificationContent([row()], translator("hi"));
        expect(hi.title).toBe("INV-00012 · बुक");
    });

    it("shows a status it has no word for exactly as it came", () => {
        const [n] = buildStaffNotificationContent([row({ status: "rescheduled" })], translator("ar"));
        expect(n.title).toBe("INV-00012 · rescheduled");
    });
});
