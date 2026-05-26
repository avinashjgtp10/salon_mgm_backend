import multer from "multer";

export const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
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
