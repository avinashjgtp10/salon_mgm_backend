import AWS from "aws-sdk";
import path from "path";
import fs from "fs";
import logger from "../../config/logger";

// ── S3 client ─────────────────────────────────────────────────────────────────
const s3 = new AWS.S3({
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
export async function uploadAvatarToS3(
  filePath: string,
  userId: string,
  mimetype: string,
): Promise<string> {
  const ext = path.extname(filePath);
  const key = `avatars/${userId}${ext}`;

  logger.info("[avatarUpload] Uploading avatar to S3", { key, BUCKET });

  if (!BUCKET) {
    // Fallback: serve from local /uploads directory when S3 is not configured
    logger.warn("[avatarUpload] AWS_S3_BUCKET not set — serving file locally");
    const filename = path.basename(filePath);
    const localUrl = `${process.env.APP_BASE_URL || ""}/uploads/${filename}`;
    return localUrl;
  }

  const fileContent = fs.readFileSync(filePath);

  const params: AWS.S3.PutObjectRequest = {
    Bucket: BUCKET,
    Key: key,
    Body: fileContent,
    ContentType: mimetype,
    ACL: "public-read",
  };

  const result = await s3.upload(params).promise();
  logger.info("[avatarUpload] Upload successful", { location: result.Location });

  // Clean up local temp file
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }

  return result.Location;
}
