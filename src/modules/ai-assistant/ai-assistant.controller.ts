import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import logger from "../../config/logger";
import config from "../../config/env";
import { aiAssistantService } from "./ai-assistant.service";
import { ChatRequestBody } from "./ai-assistant.types";
import { recommendProductsForService } from "./recommendations.service";
import { generateCampaign } from "./campaign.service";
import { dataAssistantService } from "./data/data-assistant.service";
import { explainReport, isReportKey, REPORT_PERMISSIONS } from "./report-insights.generic";
import { userCanUse } from "./ai-assistant.service";
import { explainCampaign, suggestInboxReplies, writeTemplateCopy } from "./marketing-ai.service";
import { aiAssistantRepository } from "./ai-assistant.repository";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const aiAssistantController = {
    // POST /api/v1/ai-assistant/chat
    async chat(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

            const result = await aiAssistantService.chat(
                { userId: user.userId, role: user.role, salonId: user.salonId },
                req.body as ChatRequestBody
            );
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/chat error", { err });
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/recommend-products  { service_id }
    async recommendProducts(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

            const result = await recommendProductsForService(
                { userId: user.userId, role: user.role, salonId: user.salonId },
                req.body?.service_id
            );
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/recommend-products error", { err });
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/campaign  { brief, format: "post" | "story" }
    async campaign(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");

            const result = await generateCampaign(
                { userId: user.userId, role: user.role, salonId: user.salonId },
                { brief: String(req.body.brief).trim(), format: req.body.format === "story" ? "story" : "post", count: Number(req.body.count) || 1, style: String(req.body.style ?? "auto") }
            );
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/campaign error", { err });
            return next(err);
        }
    },

    // GET /api/v1/ai-assistant/campaigns — recent posters for this salon
    async campaigns(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const items = await aiAssistantRepository.listAssets(user.salonId).catch(() => []);
            // Posters made today vs the daily cap, so the UI can show "N left today".
            const used = await aiAssistantRepository.imagesToday(user.salonId).catch(() => null);
            const usage = used === null ? null : { used, limit: config.aiAssistant.imagesPerDayPerSalon };
            return sendSuccess(res, 200, { items, usage }, "OK");
        } catch (err) {
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/template-copy  { brief, tone?, language?, category? }
    async templateCopy(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const brief = String(req.body?.brief ?? "").trim();
            if (brief.length < 8 || brief.length > 500) {
                throw new AppError(400, "Describe the message in 8–500 characters, e.g. 'Diwali offer on Hair Spa at ₹999'.", "VALIDATION_ERROR");
            }
            const result = await writeTemplateCopy(
                { userId: user.userId, role: user.role, salonId: user.salonId },
                { brief, tone: String(req.body?.tone ?? ""), language: String(req.body?.language ?? ""), category: String(req.body?.category ?? "") }
            );
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/template-copy error", { err });
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/campaign-insights  { campaign_id }
    async campaignInsights(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const result = await explainCampaign({ userId: user.userId, role: user.role, salonId: user.salonId }, req.body?.campaign_id);
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/campaign-insights error", { err });
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/inbox-replies  { phone }
    async inboxReplies(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const result = await suggestInboxReplies({ userId: user.userId, role: user.role, salonId: user.salonId }, req.body?.phone);
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/inbox-replies error", { err });
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/ask-data  { message, history? } — dashboard "Ask your data" (read-only)
    async askData(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const result = await dataAssistantService.ask(
                { userId: user.userId, role: user.role, salonId: user.salonId },
                req.body as ChatRequestBody
            );
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/ask-data error", { err });
            return next(err);
        }
    },

    // POST /api/v1/ai-assistant/report-insights  { report, filters } — report is one of REPORT_PERMISSIONS' keys
    async reportInsights(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = req.user;
            if (!user?.userId || !user.salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const report = req.body?.report;
            if (!isReportKey(report)) throw new AppError(400, "That report isn't supported yet.", "VALIDATION_ERROR");
            const actor = { userId: user.userId, role: user.role, salonId: user.salonId };
            // The user must be allowed to open this report themselves — LUNOX never shows data they couldn't see.
            if (!(await userCanUse(actor, REPORT_PERMISSIONS[report]))) {
                throw new AppError(403, `You do not have permission to view this report (${REPORT_PERMISSIONS[report]})`, "FORBIDDEN");
            }
            const result = await explainReport(actor, report, req.body?.filters);
            return sendSuccess(res, 200, result, "OK");
        } catch (err) {
            logger.error("POST /ai-assistant/report-insights error", { err });
            return next(err);
        }
    },
};
