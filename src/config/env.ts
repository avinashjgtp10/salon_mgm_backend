import dotenv from 'dotenv';
import path from 'path';

// ✅ Load .env first, then .env.local overrides it
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

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

  // Publicly-reachable URL for links handed to external services (e.g. WhatsApp
  // fetching a receipt PDF). In local dev this is the ngrok tunnel, not APP_BASE_URL
  // (a LAN address Meta's servers can't reach). Must end without a trailing slash.
  publicBaseUrl: string;

  logging: {
    level: string;
  };

  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };

  otp: {
    expMinutes: number;
  };

  groq: {
    apiKey: string;
  };

  gemini: {
    apiKey: string;
  };

  mistral: {
    apiKey: string;
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

  publicBaseUrl: (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, ''),

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
    from: required('EMAIL_FROM'),
  },

  otp: {
    expMinutes: Number(process.env.OTP_EXP_MINUTES || 10),
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || '',
  },
};

export default config;