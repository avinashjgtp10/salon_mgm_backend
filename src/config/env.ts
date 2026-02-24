import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

/**
 * ✅ Helper for required env variables
 * (does NOT affect existing config)
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

interface Config {
  env: string;
  port: number;
  apiVersion: string;

  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
  };

  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };

  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };

  cors: {
    allowedOrigins: string[];
  };

  frontend: {
    url: string;
  };

  logging: {
    level: string;
  };

  /**
   * ✅ ADD SMTP CONFIG (NEW)
   */
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };

  /**
   * ✅ ADD OTP CONFIG (NEW)
   */
  otp: {
    expMinutes: number;
  };
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000'),
  apiVersion: process.env.API_VERSION || 'v1',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'salon_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'your-refresh-secret',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  },

  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3001').split(','),
  },

  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:3001',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  /**
   * ✅ NEW SMTP CONFIG
   */
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
    from: required("EMAIL_FROM"),
  },

  /**
   * ✅ NEW OTP CONFIG
   */
  otp: {
    expMinutes: Number(process.env.OTP_EXP_MINUTES || 10),
  },
};

export default config;
