import db from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { PublicBookingRequest } from "./bookings.types";

export const bookingsService = {
    async getSalonDetails(salon_id: string) {
        // Fetch salon, services, staff for public profile
        const salon = await db.query(
            `SELECT id, name, description, phone_number, email, address_line1, city, state, country, logo_url 
             FROM salons WHERE id = $1`, [salon_id]
        );
        if (!salon.rows.length) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const services = await db.query(
            `SELECT id, name, description, duration_minutes, price, category_id 
             FROM services WHERE salon_id = $1 AND is_active = true`, [salon_id]
        );

        const staff = await db.query(
            `SELECT id, first_name, last_name, bio, title, avatar_url 
             FROM staff WHERE salon_id = $1 AND is_active = true`, [salon_id]
        );

        return {
            salon: salon.rows[0],
            services: services.rows,
            staff: staff.rows
        };
    },

    async createBooking(body: PublicBookingRequest) {
        // 1. Check if client exists by phone or email
        let client_id = null;
        let queryClient = '';
        const params: any[] = [body.salon_id];

        if (body.client_email) {
            queryClient = `SELECT id FROM clients WHERE salon_id = $1 AND email = $2`;
            params.push(body.client_email);
        } else {
            queryClient = `SELECT id FROM clients WHERE salon_id = $1 AND phone_number = $2`;
            params.push(body.client_phone);
        }

        const existingClient = await db.query(queryClient, params);

        if (existingClient.rows.length > 0) {
            client_id = existingClient.rows[0].id;
        } else {
            // Create client
            const newClient = await db.query(
                `INSERT INTO clients (salon_id, first_name, full_name, email, phone_number)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [body.salon_id, body.client_name.split(' ')[0], body.client_name, body.client_email, body.client_phone]
            );
            client_id = newClient.rows[0].id;
        }

        // 2. Fetch service duration and price
        const service = await db.query(`SELECT price, duration_minutes FROM services WHERE id = $1`, [body.service_id]);
        if (!service.rows.length) throw new AppError(404, "Service not found", "NOT_FOUND");
        const { price, duration_minutes } = service.rows[0];

        // 3. Create appointment
        const ends_at = new Date(new Date(body.scheduled_at).getTime() + duration_minutes * 60000).toISOString();

        const appointment = await db.query(
            `INSERT INTO appointments (
                salon_id, client_id, service_id, staff_id, status, scheduled_at, duration_minutes, ends_at, notes,
                services
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            ) RETURNING *`,
            [
                body.salon_id, client_id, body.service_id, body.staff_id || null, 'booked',
                body.scheduled_at, duration_minutes, ends_at, body.notes || null,
                JSON.stringify([{ service_id: body.service_id, price, quantity: 1, name: 'Service' }])
            ]
        );

        return appointment.rows[0];
    }
};
