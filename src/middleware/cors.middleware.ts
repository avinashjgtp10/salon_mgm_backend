import cors, { CorsOptionsDelegate } from "cors";
import { Request } from "express";
import logger from "../config/logger";

const corsOptions: CorsOptionsDelegate<Request> = (req, callback) => {
  const originHeader = req.header("Origin");
  
  // Normalize origin (remove trailing slash if any)
  const origin = originHeader ? originHeader.replace(/\/$/, "") : undefined;

  // Retrieve dynamically to ensure env lets it load even if imported early
  const allowedOrigins: string[] = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, ""))
    : [];

  // Log incoming request origin
  logger.info(`CORS check - Incoming Origin: ${origin || "No Origin (Postman/Mobile)"}`);

  // Postman / mobile apps (no origin header)
  if (!origin) {
    logger.info("CORS allowed: No origin detected (Postman or mobile request)");
    return callback(null, {
      origin: true,
      credentials: true,
    });
  }

  if (allowedOrigins.includes(origin)) {
    logger.info(`CORS allowed for origin: ${origin}`);

    callback(null, {
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-timezone", "x-currency", "x-salon-id"],
    });

  } else {
    logger.warn(`CORS blocked for origin: ${origin}. Allowed origins: ${allowedOrigins.join(", ")}`);
    callback(new Error("Not allowed by CORS"));
  }
};

export const corsMiddleware = cors(corsOptions);
