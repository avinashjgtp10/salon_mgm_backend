import axios from "axios";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { requireSalonAiCredentials } from "../ai-credentials/ai-credentials.service";

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

export const cloudflareImageClient = {
    // Draws a text-free background picture with FLUX schnell (Workers AI free tier).
    // The headline/price/CTA are printed on top by poster.compose.ts, because image
    // models can't be trusted to spell text.
    async generateBackground(prompt: string, salonId: string): Promise<Buffer> {
        // The salon's own Cloudflare key (set by Super Admin); no key = LUNOX is locked for this salon.
        const { accountId, apiToken } = await requireSalonAiCredentials(salonId);

        let image: string | undefined;
        try {
            const { data } = await axios.post(
                `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${MODEL}`,
                { prompt, steps: 6 },
                { headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, timeout: 90_000 }
            );
            image = data?.result?.image;
        } catch (err: any) {
            const status = err?.response?.status;
            logger.error("[ai-assistant] Cloudflare image request failed", { status, error: err?.response?.data?.errors ?? err?.message });
            if (status === 401 || status === 403) {
                throw new AppError(503, "The Cloudflare token can't be used for image generation. Ask your admin to check it.", "AI_IMAGE_NOT_CONFIGURED");
            }
            if (status === 429) {
                throw new AppError(429, "Today's free image allowance is used up. Try again tomorrow.", "AI_IMAGE_BUSY");
            }
            // Cloudflare returns 400 with an error code when a prompt trips its safety filter.
            if (status === 400) {
                throw new AppError(422, "That brief was rejected by the image safety check. Try rewording it.", "AI_IMAGE_UNSAFE");
            }
            throw new AppError(502, "Image generation failed. Please try again.", "AI_IMAGE_FAILED");
        }

        if (!image) throw new AppError(502, "Image generation returned no image. Please try again.", "AI_IMAGE_FAILED");
        return Buffer.from(image, "base64");
    },
};
