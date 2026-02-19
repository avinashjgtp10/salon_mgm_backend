import nodemailer from "nodemailer";
import config from "../../config/env";

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // ✅ 587
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
};
