"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
// src/modules/clients/clients.upload.ts
const multer_1 = __importDefault(require("multer"));
const storage = multer_1.default.memoryStorage();
exports.upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const name = file.originalname.toLowerCase();
        const ok = file.mimetype.includes("csv") ||
            name.endsWith(".csv") ||
            name.endsWith(".xlsx") ||
            name.endsWith(".xls") ||
            file.mimetype.includes("spreadsheet") ||
            file.mimetype.includes("excel");
        if (ok)
            cb(null, true);
        else
            cb(new Error("Only CSV or Excel files are allowed"));
    },
});
//# sourceMappingURL=clients.upload.js.map