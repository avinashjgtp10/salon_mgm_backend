import express, { Application } from "express";
//import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import config from "./config/env";
import logger from "./config/logger";
import { errorHandler } from "./middleware/error.middleware";
import usersRoutes from "./modules/users/users.routes";
import authRoutes from "./modules/auth/auth.routes";
import { corsMiddleware } from "./middleware/cors.middleware";
const app: Application = express();



app.set("trust proxy", 1);
// Security middleware
app.use(helmet());

app.use(corsMiddleware);
// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Compression
app.use(compression());

// Logging
if (config.env === "development") {
  app.use(morgan("dev"));
} else {
  app.use(
    morgan("combined", {
      stream: { write: (message) => logger.info(message.trim()) },
    }),
  );
}

// Health check
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
  });
});

// ✅ API ROUTES (MUST be before 404)
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);

// 404 handler (after all routes)
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
