import pool from "./config/database";
import { appointmentsRepository } from "./modules/appointments/appointments.repository";
import { paymentsService } from "./modules/payments/payments.service";

(async () => {
  const c = await pool.query(`SELECT id, salon_id FROM clients WHERE is_active = true LIMIT 1`);
  const { id: clientId, salon_id: salonId } = c.rows[0];

  const u = await pool.query(`SELECT id FROM users WHERE salon_id = $1 LIMIT 1`, [salonId]).catch(() => ({ rows: [] as any[] }));
  const requesterUserId = u.rows[0]?.id;

  const appt = await appointmentsRepository.create(
    {
      salon_id: salonId,
      client_id: clientId,
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      duration_minutes: 30,
      services: [{ service_id: undefined, name: "Test Service", price: 1000, quantity: 1, total: 1000 } as any],
    } as any,
    requesterUserId ?? "00000000-0000-0000-0000-000000000000"
  );
  console.log("Created test appointment:", appt.id, "salon", salonId);

  const payment = await paymentsService.create(
    {
      appointment_id: appt.id,
      salon_id: salonId,
      client_id: clientId,
      gross_amount: 1000,
      net_amount: 1000,
      paid_amount: 400, // partial — 600 due
      payment_method: "cash",
    } as any,
    requesterUserId
  );
  console.log("Payment result status:", (payment as any).status, "due:", (payment as any).due_amount);

  const sale = await pool.query(`SELECT id, invoice_number, status, total_amount FROM sales WHERE appointment_id = $1`, [appt.id]);
  console.log("Sale row for this appointment:", sale.rows[0] ?? "NONE — bug still present");

  const updatedAppt = await pool.query(`SELECT status, sale_id FROM appointments WHERE id = $1`, [appt.id]);
  console.log("Appointment status/sale_id:", updatedAppt.rows[0]);

  // Cleanup
  await pool.query(`DELETE FROM payments WHERE appointment_id = $1`, [appt.id]);
  await pool.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE appointment_id = $1)`, [appt.id]).catch(() => {});
  await pool.query(`DELETE FROM sales WHERE appointment_id = $1`, [appt.id]);
  await pool.query(`DELETE FROM appointments WHERE id = $1`, [appt.id]);
  console.log("Cleaned up test data");

  await pool.end();
})();
