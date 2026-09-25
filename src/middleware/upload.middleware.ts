import multer from "multer";
import path from "path";
import fs from "fs";
import { AppError } from "./error.middleware";

// __dirname-relative traversal breaks once esbuild bundles this file into a
// single dist/index.js: the extra directory level collapses and "../../uploads"
// escapes past the app root entirely (e.g. /app/dist -> /uploads). process.cwd()
// is stable across both the bundled prod build (WORKDIR /app) and local
// ts-node-dev (run from the repo root).
const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    },
});

const fileFilter = (
    _req: any,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
) => {
    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new AppError(400, "Only image files are allowed", "VALIDATION_ERROR"));
    }
};

export const uploadMiddleware = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB
    },
});
