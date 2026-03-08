// src/modules/clients/clients.upload.ts
import multer from "multer";

const storage = multer.memoryStorage();

export const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const name = file.originalname.toLowerCase();
        const ok =
            file.mimetype.includes("csv") ||
            name.endsWith(".csv") ||
            name.endsWith(".xlsx") ||
            name.endsWith(".xls") ||
            file.mimetype.includes("spreadsheet") ||
            file.mimetype.includes("excel");
        if (ok) cb(null, true);
        else cb(new Error("Only CSV or Excel files are allowed"));
    },
});
