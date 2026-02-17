import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "./error.middleware";

export const authMiddleware = (
  req: Request & { user?: any },
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AppError(401, "Authorization header missing", "NO_AUTH_HEADER");
    }

    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || !token) {
      throw new AppError(401, "Invalid token format", "INVALID_TOKEN_FORMAT");
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new AppError(500, "JWT access secret missing", "JWT_SECRET_MISSING");
    }

    const decoded = jwt.verify(token, secret);

    req.user = decoded;
    return next();
  } catch (err) {
    return next(new AppError(401, "Unauthorized", "INVALID_TOKEN"));
  }
};
