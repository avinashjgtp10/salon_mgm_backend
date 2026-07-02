import nodemailer from "nodemailer";
import config from "../../config/env";

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // 587
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
  requireTLS: true,
});

const escapeHtml = (value: string | null | undefined) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatDateTime = (value: string | undefined) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
};

export const emailService = {
  async verifyConnection() {
    await transporter.verify();
  },

  async sendOtpEmail(email: string, otp: string) {
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: "Your Email OTP Verification",
      html: `
        <div style="font-family: Arial, sans-serif">
          <h2>Email Verification</h2>
          <p>Your OTP code is:</p>
          <h1 style="letter-spacing: 4px;">${otp}</h1>
          <p>This OTP expires in ${config.otp.expMinutes} minutes.</p>
        </div>
      `,
    });
  },

  async sendPasswordResetOtpEmail(email: string, otp: string) {
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif, max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Password Reset Verification</h2>
          <p style="color: #666; font-size: 16px;">We received a request to reset your password. Here is your verification code:</p>
          <div style="background-color: #f4f4f7; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="letter-spacing: 6px; color: #6366f1; margin: 0; font-size: 32px;">${otp}</h1>
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in ${config.otp.expMinutes} minutes. If you did not request a password reset, please ignore this email.</p>
        </div>
      `,
    });
  },

  async sendPasswordResetConfirmationEmail(params: {
    to: string;
    fullName: string;
    resetAt: Date;
  }) {
    const { to, fullName, resetAt } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const formattedDate = resetAt.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedTime = resetAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: "Your SalonOx Password Has Been Reset Successfully",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Password Reset Confirmation</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:10px;overflow:hidden;
                         box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:560px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:36px 40px;text-align:center;">
                      <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
                        SalonOx
                      </h1>
                      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                        Password Reset Confirmation
                      </p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px 40px 24px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        Hi <strong>${fullName}</strong>,
                      </p>
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        Your <strong>SalonOx</strong> account password has been successfully reset.
                      </p>

                      <!-- Reset Details Box -->
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin:24px 0;">
                        <tr>
                          <td style="padding:20px 24px;">
                            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;
                                      letter-spacing:0.05em;font-weight:600;">
                              Reset Details
                            </p>
                            <p style="margin:0 0 4px;color:#374151;font-size:14px;">
                              <strong>Date:</strong> ${formattedDate}
                            </p>
                            <p style="margin:0;color:#374151;font-size:14px;">
                              <strong>Time:</strong> ${formattedTime}
                            </p>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:0 0 32px;color:#374151;font-size:15px;line-height:1.6;">
                        You can now log in to your SalonOx account using your new password.
                      </p>

                      <!-- CTA Button -->
                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${loginUrl}"
                               style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;
                                      padding:14px 48px;border-radius:8px;
                                      box-shadow:0 4px 12px rgba(99,102,241,0.4);">
                              Login Now
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Security Notice -->
                  <tr>
                    <td style="padding:24px 40px;">
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#fef3c7;border-radius:8px;border:1px solid #fcd34d;">
                        <tr>
                          <td style="padding:16px 20px;">
                            <p style="margin:0 0 8px;color:#92400e;font-size:14px;font-weight:600;">
                              Security Notice
                            </p>
                            <p style="margin:0 0 6px;color:#92400e;font-size:13px;line-height:1.6;">
                              If you did not request this password reset, please contact our support team immediately — your account may be at risk.
                            </p>
                            <p style="margin:0;color:#92400e;font-size:13px;">
                              Support: <a href="mailto:support@salonox.com" style="color:#6366f1;">support@salonox.com</a>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;text-align:center;">
                        © ${new Date().getFullYear()} SalonOx. All rights reserved.
                      </p>
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                        This is an automated security notification. Please do not reply to this email.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendWelcomeEmail(params: {
    to: string;
    fullName: string;
    salonName: string;
  }) {
    const { to, fullName, salonName } = params;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Welcome to SalonOx, ${fullName}! 🎉`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Welcome to SalonOx</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="580" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;
                         box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:580px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:40px 40px 32px;text-align:center;">
                      <h1 style="margin:0 0 4px;color:#ffffff;font-size:28px;font-weight:800;
                                 letter-spacing:-0.5px;">
                        SalonOx
                      </h1>
                      <p style="margin:0;color:rgba(255,255,255,0.80);font-size:13px;
                                letter-spacing:2px;text-transform:uppercase;">
                        Salon Management Platform
                      </p>
                    </td>
                  </tr>

                  <!-- Welcome Banner -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:0 40px 40px;text-align:center;">
                      <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:20px 24px;">
                        <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">
                          Welcome aboard, ${fullName}!
                        </p>
                        <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">
                          Your salon account is ready.
                        </p>
                      </div>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:36px 40px 28px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.7;">
                        Hi <strong>${fullName}</strong>,
                      </p>
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.7;">
                        Congratulations! Your SalonOx account for
                        <strong>${salonName}</strong> has been successfully created.
                        We're thrilled to have you on board.
                      </p>
                      <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.7;">
                        SalonOx helps you manage appointments, staff, clients, and
                        grow your salon business — all from one place.
                      </p>

                      <!-- Getting Started Steps -->
                      <div style="background:#f9fafb;border-radius:10px;padding:24px 28px;margin-bottom:28px;">
                        <p style="margin:0 0 16px;color:#374151;font-size:15px;font-weight:700;">
                          Get started in 3 easy steps:
                        </p>
                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="width:32px;vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                                          border-radius:50%;text-align:center;line-height:24px;
                                          color:#fff;font-size:12px;font-weight:700;">1</div>
                            </td>
                            <td style="padding-left:12px;padding-bottom:14px;">
                              <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                                Complete your salon profile
                              </p>
                              <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">
                                Add your salon details, logo, and working hours.
                              </p>
                            </td>
                          </tr>
                          <tr>
                            <td style="width:32px;vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                                          border-radius:50%;text-align:center;line-height:24px;
                                          color:#fff;font-size:12px;font-weight:700;">2</div>
                            </td>
                            <td style="padding-left:12px;padding-bottom:14px;">
                              <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                                Add your services &amp; staff
                              </p>
                              <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">
                                Set up your service menu and invite your team members.
                              </p>
                            </td>
                          </tr>
                          <tr>
                            <td style="width:32px;vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                                          border-radius:50%;text-align:center;line-height:24px;
                                          color:#fff;font-size:12px;font-weight:700;">3</div>
                            </td>
                            <td style="padding-left:12px;">
                              <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                                Start accepting bookings
                              </p>
                              <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">
                                Share your booking link and watch appointments roll in.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </div>

                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">
                        &copy; ${new Date().getFullYear()} SalonOx. All rights reserved.
                      </p>
                      <p style="margin:0;color:#d1d5db;font-size:11px;text-align:center;">
                        You received this email because you created an account on SalonOx.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendAccountCreatedEmail(params: {
    to: string;
    fullName: string;
    email: string;
    password: string;
    role: string;
  }) {
    const { to, fullName, email, password, role } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const roleLabel = role === "salon_owner" ? "Salon Owner" : role.charAt(0).toUpperCase() + role.slice(1);

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: "Your SalonOx Account Has Been Created",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Account Created – SalonOx</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;
                         box-shadow:0 4px 24px rgba(0,0,0,0.09);max-width:560px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:36px 40px 28px;text-align:center;">
                      <h1 style="margin:0 0 4px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">SalonOx</h1>
                      <p style="margin:0;color:rgba(255,255,255,0.82);font-size:13px;letter-spacing:1.5px;text-transform:uppercase;">Account Created by Admin</p>
                    </td>
                  </tr>

                  <!-- Greeting -->
                  <tr>
                    <td style="padding:36px 40px 0;">
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">
                        Hi <strong>${fullName}</strong>,
                      </p>
                      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">
                        A <strong>SalonOx</strong> account has been created for you by the platform administrator.
                        You can log in immediately using the credentials below.
                      </p>
                    </td>
                  </tr>

                  <!-- Credentials Box -->
                  <tr>
                    <td style="padding:0 40px 28px;">
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#f5f3ff;border-radius:10px;border:1.5px solid #ede9fe;">
                        <tr>
                          <td style="padding:24px 28px;">
                            <p style="margin:0 0 16px;color:#6d28d9;font-size:12px;font-weight:700;
                                      text-transform:uppercase;letter-spacing:0.08em;">
                              Your Login Credentials
                            </p>

                            <table cellpadding="0" cellspacing="0" width="100%">
                              <tr>
                                <td style="padding-bottom:12px;">
                                  <p style="margin:0 0 3px;color:#7c3aed;font-size:11px;font-weight:600;text-transform:uppercase;">Role</p>
                                  <p style="margin:0;color:#1f2937;font-size:15px;font-weight:600;">${roleLabel}</p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom:12px;border-top:1px solid #ede9fe;padding-top:12px;">
                                  <p style="margin:0 0 3px;color:#7c3aed;font-size:11px;font-weight:600;text-transform:uppercase;">Email Address</p>
                                  <p style="margin:0;color:#1f2937;font-size:15px;font-weight:600;">${email}</p>
                                </td>
                              </tr>
                              <tr>
                                <td style="border-top:1px solid #ede9fe;padding-top:12px;">
                                  <p style="margin:0 0 3px;color:#7c3aed;font-size:11px;font-weight:600;text-transform:uppercase;">Password</p>
                                  <p style="margin:0;background:#ede9fe;border-radius:6px;padding:8px 14px;
                                            color:#1f2937;font-size:17px;font-weight:700;letter-spacing:2px;
                                            font-family:monospace;">${password}</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- CTA -->
                  <tr>
                    <td style="padding:0 40px 32px;">
                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${loginUrl}"
                               style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;
                                      padding:14px 48px;border-radius:8px;
                                      box-shadow:0 4px 14px rgba(99,102,241,0.45);">
                              Login to Your Account
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Security Notice -->
                  <tr>
                    <td style="padding:0 40px 28px;">
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#fffbeb;border-radius:8px;border:1px solid #fcd34d;">
                        <tr>
                          <td style="padding:14px 18px;">
                            <p style="margin:0 0 5px;color:#92400e;font-size:13px;font-weight:700;">
                              Important – Change your password after first login
                            </p>
                            <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
                              For your security, please update your password as soon as you log in for the first time.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">
                        &copy; ${new Date().getFullYear()} SalonOx. All rights reserved.
                      </p>
                      <p style="margin:0;color:#d1d5db;font-size:11px;text-align:center;">
                        This account was created by a platform administrator. If you did not expect this, please contact support.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendSupportTicketCreatedEmail(params: {
    ticketId: string;
    subject: string;
    category?: string | null;
    message: string;
    priority: string;
    salonName?: string | null;
    submitterName?: string | null;
    submitterEmail?: string | null;
    createdAt?: string;
  }) {
    const supportRecipient =
      process.env.SUPPORT_NOTIFICATION_EMAIL || config.smtp.user || config.smtp.from;
    const adminUrl = `${config.frontend.url}/super-admin/support`;
    const priority = params.priority || "medium";
    const priorityColor =
      priority === "high" ? "#dc2626" : priority === "low" ? "#059669" : "#d97706";

    await transporter.sendMail({
      from: config.smtp.from,
      to: supportRecipient,
      subject: `[SalonOx Support] ${priority.toUpperCase()} - ${params.subject}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>New Support Ticket</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">
                  <tr>
                    <td style="background:#111827;padding:28px 32px;">
                      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">New Support Ticket</h1>
                      <p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">A salon user raised a support request.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px 32px;">
                      <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:0.08em;">Subject</p>
                      <h2 style="margin:0 0 20px;color:#111827;font-size:19px;line-height:1.35;">${escapeHtml(params.subject)}</h2>

                      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:20px;">
                        <tr>
                          <td style="padding:16px 18px;">
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Ticket ID:</strong> ${escapeHtml(params.ticketId)}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Salon:</strong> ${escapeHtml(params.salonName || "Unknown")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Submitted by:</strong> ${escapeHtml(params.submitterName || "Unknown")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Email:</strong> ${escapeHtml(params.submitterEmail || "Not available")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Category:</strong> ${escapeHtml(params.category || "general")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Created:</strong> ${formatDateTime(params.createdAt)}</p>
                            <p style="margin:0;color:#374151;font-size:14px;"><strong>Priority:</strong> <span style="color:${priorityColor};font-weight:700;text-transform:capitalize;">${escapeHtml(priority)}</span></p>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:0.08em;">Message</p>
                      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin-bottom:24px;color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(params.message)}</div>

                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${adminUrl}"
                               style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">
                              Open Support Dashboard
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">This notification was sent by SalonOx automatically.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  // ── Business Event Notifications ─────────────────────────────────────────────

  async sendNewAppointmentEmail(params: {
    to: string;
    salonName: string;
    clientName: string;
    services: string;
    date: string;
    time: string;
    appointmentId: string;
  }) {
    const { to, salonName, clientName, services, date, time, appointmentId } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `New Appointment Booked — ${clientName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#111827;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${salonName}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">New Appointment Booked</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      A new appointment has been booked. Here are the details:
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 12px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Appointment Details</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Client:</strong> ${escapeHtml(clientName)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Service:</strong> ${escapeHtml(services)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Date:</strong> ${escapeHtml(date)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Time:</strong> ${escapeHtml(time)}</p>
                          <p style="margin:0;color:#6b7280;font-size:12px;">Ref: ${escapeHtml(appointmentId.slice(0, 8).toUpperCase())}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendAppointmentCancelledEmail(params: {
    to: string;
    clientName: string;
    salonName: string;
    date: string;
    time: string;
  }) {
    const { to, clientName, salonName, date, time } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Your Appointment has been Cancelled — ${salonName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#dc2626;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Appointment Cancelled</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(clientName)}</strong>, your appointment at <strong>${escapeHtml(salonName)}</strong> has been cancelled.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>Date:</strong> ${escapeHtml(date)}</p>
                          <p style="margin:0;color:#991b1b;font-size:14px;"><strong>Time:</strong> ${escapeHtml(time)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      Please contact us if you'd like to rebook or if you have any questions.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendAppointmentCancelledOwnerEmail(params: {
    to: string;
    salonName: string;
    clientName: string;
    date: string;
    time: string;
    appointmentId: string;
  }) {
    const { to, salonName, clientName, date, time, appointmentId } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Appointment Cancelled — ${clientName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#dc2626;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Appointment Cancelled</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      An appointment has been cancelled. Here are the details:
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>Client:</strong> ${escapeHtml(clientName)}</p>
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>Date:</strong> ${escapeHtml(date)}</p>
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>Time:</strong> ${escapeHtml(time)}</p>
                          <p style="margin:0;color:#991b1b;font-size:12px;">Ref: ${escapeHtml(appointmentId.slice(0, 8).toUpperCase())}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendAppointmentCompletedEmail(params: {
    to: string;
    clientName: string;
    salonName: string;
    services: string;
    amount: string;
  }) {
    const { to, clientName, salonName, services, amount } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Your Appointment Receipt — ${salonName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#16a34a;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Thank You for Your Visit!</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(clientName)}</strong>, thank you for visiting <strong>${escapeHtml(salonName)}</strong>. Here's your receipt:
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#15803d;font-size:14px;"><strong>Services:</strong> ${escapeHtml(services)}</p>
                          <p style="margin:0;color:#15803d;font-size:16px;font-weight:700;"><strong>Total:</strong> ₹${escapeHtml(amount)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      We hope to see you again soon!
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendNewPaymentEmail(params: {
    to: string;
    salonName: string;
    clientName: string;
    amount: string;
    paymentMethod: string;
    invoiceId: string;
  }) {
    const { to, salonName, clientName, amount, paymentMethod, invoiceId } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Payment Received — ₹${amount}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#111827;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Payment Received</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      A payment has been recorded for <strong>${escapeHtml(clientName)}</strong>.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Client:</strong> ${escapeHtml(clientName)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:800;color:#16a34a;">₹${escapeHtml(amount)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Method:</strong> ${escapeHtml(paymentMethod)}</p>
                          <p style="margin:0;color:#6b7280;font-size:12px;">Invoice: ${escapeHtml(invoiceId)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendNewClientEmail(params: {
    to: string;
    salonName: string;
    clientName: string;
    clientEmail?: string;
    clientPhone?: string;
  }) {
    const { to, salonName, clientName, clientEmail, clientPhone } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `New Client Added — ${clientName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#111827;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">New Client Added</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      A new client has been added to <strong>${escapeHtml(salonName)}</strong>.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Name:</strong> ${escapeHtml(clientName)}</p>
                          ${clientEmail ? `<p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>Email:</strong> ${escapeHtml(clientEmail)}</p>` : ""}
                          ${clientPhone ? `<p style="margin:0;color:#111827;font-size:14px;"><strong>Phone:</strong> ${escapeHtml(clientPhone)}</p>` : ""}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendStaffLoginEmail(params: {
    to: string;
    salonName: string;
    staffName: string;
    staffEmail: string;
    loginTime: string;
  }) {
    const { to, salonName, staffName, staffEmail, loginTime } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Staff Login Alert — ${staffName} signed in`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#1e40af;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Staff Login Alert</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      A team member has signed in to <strong>${escapeHtml(salonName)}</strong>.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#1e40af;font-size:14px;"><strong>Name:</strong> ${escapeHtml(staffName)}</p>
                          <p style="margin:0 0 8px;color:#1e40af;font-size:14px;"><strong>Email:</strong> ${escapeHtml(staffEmail)}</p>
                          <p style="margin:0;color:#1e40af;font-size:14px;"><strong>Time:</strong> ${escapeHtml(loginTime)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      If this login was not expected, please review your team's access permissions.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendStaffInvitation(params: {
    to: string;
    token: string;
    staffFirstName: string;
    salonName: string;
  }) {
    const { to, token, staffFirstName, salonName } = params;
    const inviteLink = `${config.frontend.url}/accept-invite?token=${token}`;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `You've been invited to join ${salonName}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Staff Invitation</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:10px;overflow:hidden;
                         box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:560px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:36px 40px;text-align:center;">
                      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;
                                 letter-spacing:-0.5px;">
                        ${salonName}
                      </h1>
                      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                        Staff Invitation
                      </p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px 40px 32px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        Hi <strong>${staffFirstName}</strong>,
                      </p>
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        You have been invited to join <strong>${salonName}</strong> as a staff member
                        on our platform. Click the button below to set up your account and get started.
                      </p>
                      <p style="margin:0 0 32px;color:#6b7280;font-size:14px;line-height:1.6;">
                        This invitation link will expire in <strong>72 hours</strong>.
                      </p>

                      <!-- CTA Button -->
                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${inviteLink}"
                               style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;
                                      padding:14px 40px;border-radius:8px;
                                      box-shadow:0 4px 12px rgba(99,102,241,0.4);">
                              Accept Invitation
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Fallback link -->
                  <tr>
                    <td style="padding:0 40px 24px;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                        If the button doesn't work, copy and paste this link into your browser:
                      </p>
                      <p style="margin:4px 0 0;word-break:break-all;">
                        <a href="${inviteLink}" style="color:#6366f1;font-size:12px;">${inviteLink}</a>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                        If you did not expect this invitation, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },
};
