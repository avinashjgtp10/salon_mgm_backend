import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { paymentsRepository } from './payments.repository';
import { couponsRepository } from '../coupons/coupons.repository';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { CreatePaymentBody, Payment } from './payments.types';

export const paymentsService = {

  async create(data: CreatePaymentBody): Promise<Payment> {
    // ── Recompute financial fields from real appointment data ─────────────────
    // This prevents bugs where the frontend sends a wrong gross_amount
    // (e.g., partial-payment amount instead of the full bill total).
    if (data.appointment_id) {
      try {
        const appt = await appointmentsRepository.findById(data.appointment_id);
        if (appt) {
          // Use Number() guards — JSONB prices can arrive as strings or be undefined
          const serviceTotal    = (appt.services         || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const packageTotal    = (appt.package_items    || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const productTotal    = (appt.product_items    || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const membershipTotal = (appt.membership_items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const actualBill      = serviceTotal + packageTotal + productTotal + membershipTotal;

          // If the appointment has no priced items, fall through to frontend values
          if (!isFinite(actualBill) || actualBill <= 0) throw new Error('no_priced_items');

          const discount      = Math.max(0, Number(data.discount_amount) || 0);
          const ewallet       = Math.max(0, Number(data.ewallet_used)    || 0);
          const effectiveBill = Math.max(0, actualBill - discount - ewallet);

          // Sum previously paid amounts across all prior payments for this appointment
          const existingPaid = await paymentsRepository.getTotalPaidForAppointment(data.appointment_id);
          const thisPaid     = Math.max(0, Number(data.paid_amount) || Number(data.net_amount) || Number(data.gross_amount) || 0);

          data.gross_amount = actualBill;
          data.net_amount   = effectiveBill;
          data.paid_amount  = thisPaid;
          data.due_amount   = Math.max(0, parseFloat((effectiveBill - existingPaid - thisPaid).toFixed(2)));
          data.status       = data.due_amount > 0 ? 'partial' : 'completed';
        }
      } catch {
        // Non-fatal: fall through and use frontend-supplied values
      }
    }

    const payment = await paymentsRepository.create(data);

    // Increment coupon used_count
    if (data.coupon_code) {
      const coupon = await couponsRepository.findByCode(data.coupon_code);
      if (coupon) await couponsRepository.incrementUsed(coupon.id);
    }

    // Mark appointment payment_status based on computed due_amount
    if (data.appointment_id) {
      try {
        const apptStatus = (data.due_amount ?? 0) > 0 ? 'partial' : 'paid';
        await appointmentsRepository.updatePaymentStatus(data.appointment_id, apptStatus);
      } catch {
        // Non-fatal: payment is still recorded
      }
    }

    return payment;
  },

  async getByAppointmentId(appointmentId: string): Promise<Payment | null> {
    return paymentsRepository.findByAppointmentId(appointmentId);
  },

  async listBySalon(salonId: string): Promise<Payment[]> {
    return paymentsRepository.findBySalonId(salonId);
  },

  async exportPayments(filters: {
    salon_id: string;
    start_date?: string;
    end_date?: string;
    payment_method?: string;
    status?: string;
    format: 'csv' | 'excel' | 'pdf';
  }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const records = await paymentsRepository.exportList({
      salon_id: filters.salon_id,
      start_date: filters.start_date,
      end_date: filters.end_date,
      payment_method: filters.payment_method,
      status: filters.status,
    });

    const dateLabel = filters.start_date ?? 'all';
    const headers = ['Sale #', 'Client Name', 'Payment Method', 'Gross', 'Discount', 'Net Amount', 'Paid', 'Due', 'Status', 'Date & Time'];
    const rows = records.map(r => [
      r.sale_invoice ?? r.id,
      (r as any).client_name || 'Walk-in',
      r.payment_method,
      r.gross_amount,
      r.discount_amount,
      r.net_amount,
      r.paid_amount,
      r.due_amount,
      r.status,
      r.paid_at ? new Date(r.paid_at).toLocaleString('en-GB') : '',
    ]);

    if (filters.format === 'csv') {
      const csvLines = [headers.join(','), ...rows.map(r => r.join(','))];
      return {
        buffer: Buffer.from(csvLines.join('\n'), 'utf-8'),
        contentType: 'text/csv',
        filename: `payment-transactions-${dateLabel}.csv`,
      };
    }

    if (filters.format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Payment Transactions');
      sheet.addRow(headers).font = { bold: true };
      rows.forEach(r => sheet.addRow(r));
      sheet.columns.forEach(col => { col.width = 20; });
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      return {
        buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `payment-transactions-${dateLabel}.xlsx`,
      };
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: 'application/pdf',
        filename: `payment-transactions-${dateLabel}.pdf`,
      }));
      doc.on('error', reject);

      doc.fontSize(16).font('Helvetica-Bold').text('Payment Transactions Report', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(`Date: ${filters.start_date ?? 'All'}`, { align: 'center' });
      doc.moveDown(1.5);

      const colWidths = [80, 90, 70, 50, 55, 60, 50, 45, 60, 90];
      const startX = 40;
      const rowHeight = 18;
      let y = doc.y;

      const drawRow = (cells: string[], isHeader = false) => {
        let x = startX;
        if (isHeader) {
          doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#333333');
          doc.fillColor('white').font('Helvetica-Bold').fontSize(7);
        } else {
          doc.fillColor('black').font('Helvetica').fontSize(7);
        }
        cells.forEach((cell, i) => {
          doc.text(String(cell), x + 2, y + 4, { width: colWidths[i] - 4, ellipsis: true, lineBreak: false });
          x += colWidths[i];
        });
        y += rowHeight;
      };

      drawRow(headers, true);
      rows.forEach((row, idx) => {
        if (idx % 2 === 0) {
          doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f5f5f5');
        }
        drawRow(row.map(String));
      });

      if (rows.length === 0) {
        doc.fillColor('#999').fontSize(10).text('No payment records found.', startX, y + 10, { align: 'center' });
      }
      doc.end();
    });
  },
};
