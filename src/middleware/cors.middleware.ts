import cors, { CorsOptionsDelegate } from "cors";
import { Request } from "express";
import logger from "../config/logger";

const allowedOrigins: string[] =
process.env.CORS_ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()) || [];

const corsOptions: CorsOptionsDelegate<Request> = (req, callback) => {
const origin = req.header("Origin");


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
      allowedHeaders: ["Content-Type", "Authorization"],
    });

  } else {
    logger.warn(`CORS blocked for origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  }
};

export const corsMiddleware = cors(corsOptions);
