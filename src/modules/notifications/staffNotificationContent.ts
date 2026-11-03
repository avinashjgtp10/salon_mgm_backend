export interface StaffAppointmentRow {
  user_id: string;
  staff_id: string;
  appointment_staff_id: string | null;
  client_name: string | null;
  invoice_number: string | number | null;
  status: string;
  service_name: string | null;
  services: { staff_id?: string | number | null; name?: string; title?: string }[] | null;
}

export interface StaffNotificationContent {
  userId: string;
  title: string;
  body: string;
}

export function buildStaffNotificationContent(rows: StaffAppointmentRow[]): StaffNotificationContent[] {
  const groups = new Map<string, { row: StaffAppointmentRow; names: string[] }>();
  for (const row of rows) {
    const services = Array.isArray(row.services) ? row.services : [];
    const hasAssignments = services.some(service => String(service.staff_id ?? "").trim());
    const ownServices = hasAssignments
      ? services.filter(service => String(service.staff_id ?? "").trim() === row.staff_id)
      : row.appointment_staff_id === row.staff_id ? services : [];
    const names = ownServices.map(service => service.name?.trim() || service.title?.trim() || "Service");
    if (!hasAssignments && !services.length && row.appointment_staff_id === row.staff_id) {
      names.push(row.service_name?.trim() || "Service");
    }
    if (!names.length) continue;
    const group = groups.get(row.user_id) ?? { row, names: [] };
    group.names.push(...names);
    groups.set(row.user_id, group);
  }
  return [...groups].map(([userId, { row, names }]) => {
    const letters = Array.from(row.client_name?.trim() || "Walk-in");
    const name = letters.slice(0, 2).join("") + "*".repeat(Math.max(0, letters.length - 2));
    const number = String(row.invoice_number ?? "").trim();
    const invoice = number ? (number.startsWith("INV-") ? number : `INV-${number.padStart(5, "0")}`) : "Invoice not generated";
    return { userId, title: `${invoice} · ${row.status}`, body: `${name} — ${names.join(", ")}` };
  });
}
