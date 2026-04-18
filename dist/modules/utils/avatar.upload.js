"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAvatarToS3 = uploadAvatarToS3;
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = __importDefault(require("../../config/logger"));
// ── S3 client ─────────────────────────────────────────────────────────────────
const s3 = new aws_sdk_1.default.S3({
    region: process.env.AWS_REGION || "us-east-1",
    // If no explicit keys are set the SDK falls back to the EC2 instance's
    // IAM role credentials automatically (recommended on EC2)
    ...(process.env.AWS_ACCESS_KEY_ID && {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }),
});
const BUCKET = process.env.AWS_S3_BUCKET || "";
// ── Upload a file (from disk path) to S3 ─────────────────────────────────────
async function uploadAvatarToS3(filePath, userId, mimetype) {
    const ext = path_1.default.extname(filePath);
    const key = `avatars/${userId}${ext}`;
    logger_1.default.info("[avatarUpload] Uploading avatar to S3", { key, BUCKET });
    if (!BUCKET) {
        // Fallback: serve from local /uploads directory when S3 is not configured
        logger_1.default.warn("[avatarUpload] AWS_S3_BUCKET not set — serving file locally");
        const filename = path_1.default.basename(filePath);
        const localUrl = `${process.env.APP_BASE_URL || ""}/uploads/${filename}`;
        return localUrl;
    }
    const fileContent = fs_1.default.readFileSync(filePath);
    const params = {
        Bucket: BUCKET,
        Key: key,
        Body: fileContent,
        ContentType: mimetype,
        ACL: "public-read",
    };
    const result = await s3.upload(params).promise();
    logger_1.default.info("[avatarUpload] Upload successful", { location: result.Location });
    // Clean up local temp file
    try {
        fs_1.default.unlinkSync(filePath);
    }
    catch { /* ignore */ }
    return result.Location;
}
//# sourceMappingURL=avatar.upload.js.map