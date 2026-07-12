import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";
import { aiEngineService } from "./ai-engine.service";
import { ChatRequestBody } from "./ai-engine.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const aiEngineController = {
    // POST /api/v1/ai-engine/chat — debug endpoint, exercises the full LUNOX
    // agent loop against real salon data without needing a live WhatsApp send.
    async chat(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

            const { phone, message } = req.body as ChatRequestBody;
            const result = await aiEngineService.chat({ salonId, phone, message });

            return sendSuccess(res, 200, result, "LUNOX reply generated");
        } catch (err) {
            logger.error("POST /ai-engine/chat error", { err });
            return next(err);
        }
    },
};
