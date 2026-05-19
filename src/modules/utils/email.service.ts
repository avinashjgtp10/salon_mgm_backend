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

