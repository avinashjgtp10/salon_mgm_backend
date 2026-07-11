import { AppError } from "../../middleware/error.middleware";
import {
    ResolvedDateRange,
    SALES_SUMMARY_PERIODS,
    SalesSummaryPeriod,
} from "./reports.types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const pad = (value: number): string =>
    String(value).padStart(2, "0");

const toDateString = (date: Date): string =>
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
        date.getUTCDate()
    )}`;

const getTodayUTC = (): Date => {
    const now = new Date();

    return new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        )
    );
};

const addDays = (date: Date, days: number): Date => {
    const d = new Date(date);

    d.setUTCDate(d.getUTCDate() + days);

    return d;
};

const startOfMonth = (date: Date): Date =>
    new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            1
        )
    );

const startOfYear = (date: Date): Date =>
    new Date(
        Date.UTC(
            date.getUTCFullYear(),
            0,
            1
        )
    );

/**
 * Resolve report date range.
 *
 * Rules:
 *
 * today
 * weekly  -> last 7 days
 * monthly -> first day of month
 * yearly  -> first day of year
 *
 * Custom from/to overrides period.
 */

export const resolveDateRange = (
    periodQ?: string,
    fromQ?: string,
    toQ?: string
): ResolvedDateRange => {

    if (!periodQ) {
        throw new AppError(
            400,
            "period is required",
            "VALIDATION_ERROR"
        );
    }

    if (
        !SALES_SUMMARY_PERIODS.includes(
            periodQ as SalesSummaryPeriod
        )
    ) {
        throw new AppError(
            400,
            `period must be one of ${SALES_SUMMARY_PERIODS.join(", ")}`,
            "VALIDATION_ERROR"
        );
    }

    const period =
        periodQ as SalesSummaryPeriod;

    // -------------------------
    // Custom Date Range
    // -------------------------

    if (fromQ || toQ) {

        if (!fromQ || !toQ) {
            throw new AppError(
                400,
                "from and to are required together",
                "VALIDATION_ERROR"
            );
        }

        if (
            !DATE_REGEX.test(fromQ) ||
            !DATE_REGEX.test(toQ)
        ) {
            throw new AppError(
                400,
                "Date format must be YYYY-MM-DD",
                "VALIDATION_ERROR"
            );
        }

        return {
            period,
            from: fromQ <= toQ ? fromQ : toQ,
            to: fromQ <= toQ ? toQ : fromQ,
        };
    }

    const today = getTodayUTC();

    switch (period) {

        case "today":

            return {
                period,
                from: toDateString(today),
                to: toDateString(today),
            };

        case "weekly":

            return {
                period,
                from: toDateString(addDays(today, -6)),
                to: toDateString(today),
            };

        case "monthly":

            return {
                period,
                from: toDateString(startOfMonth(today)),
                to: toDateString(today),
            };

        case "yearly":

            return {
                period,
                from: toDateString(startOfYear(today)),
                to: toDateString(today),
            };

        default:

            return {
                period,
                from: toDateString(startOfMonth(today)),
                to: toDateString(today),
            };
    }
};

// =============================
// Number Helpers
// =============================

export const toNum = (
    value: string | number | null | undefined
): number => {

    if (value === null || value === undefined) {
        return 0;
    }

    const number =
        typeof value === "number"
            ? value
            : parseFloat(value);

    return Number.isFinite(number)
        ? number
        : 0;
};

export const round2 = (
    value: number
): number => {

    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.round(
        (value + Number.EPSILON) * 100
    ) / 100;
};

export const safeDiv = (
    numerator: number,
    denominator: number
): number => {

    if (!denominator) {
        return 0;
    }

    return round2(
        numerator / denominator
    );
};

export const percentage = (
    value: number,
    total: number
): number => {

    if (!total) {
        return 0;
    }

    return round2(
        (value * 100) / total
    );
};

export const sumNumbers = (
    values: number[]
): number =>{

    return round2(
        values.reduce(
            (total, current) => total + current,
            0
        )
    );
};