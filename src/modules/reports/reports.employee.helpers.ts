import { AppError } from "../../middleware/error.middleware";
import type {
  EmployeePerformanceQuery,
  EmployeePerformanceSortBy,
  EmployeePerformanceSortOrder,
} from "./reports.types";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export interface NormalizedEmployeePerformanceQuery {
  from: string;
  to: string;
  employeeId?: string;
  role?: string;
  department?: string;
  search?: string;
  sortBy: EmployeePerformanceSortBy;
  sortOrder: EmployeePerformanceSortOrder;
  page: number;
  pageSize: number;
}

export function normalizeEmployeePerformanceQuery(
  query: EmployeePerformanceQuery,
): NormalizedEmployeePerformanceQuery {
  const from = String(query.from ?? "").trim();
  const to = String(query.to ?? "").trim();

  if (!from || !to) {
    throw new AppError(400, "from and to are required", "VALIDATION_ERROR");
  }

  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new AppError(400, "from and to must be valid dates in YYYY-MM-DD format", "VALIDATION_ERROR");
  }

  if (new Date(`${from}T00:00:00Z`).getTime() > new Date(`${to}T00:00:00Z`).getTime()) {
    throw new AppError(400, "from cannot be greater than to", "VALIDATION_ERROR");
  }

  const sortBy = normalizeSortBy(query.sortBy);
  const sortOrder = normalizeSortOrder(query.sortOrder);
  const page = normalizePositiveInt(query.page, DEFAULT_PAGE);
  const pageSize = Math.min(normalizePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  return {
    from,
    to,
    employeeId: normalizeOptional(query.employeeId),
    role: normalizeOptional(query.role),
    department: normalizeOptional(query.department),
    search: normalizeOptional(query.search),
    sortBy,
    sortOrder,
    page,
    pageSize,
  };
}

export function getEmployeePerformanceSortColumn(sortBy: EmployeePerformanceSortBy): string {
  switch (sortBy) {
    case "utilization":
      return "utilization_percentage";
    case "bookings":
      return "total_bookings";
    case "revenue":
    default:
      return "total_revenue_generated";
  }
}

function normalizeSortBy(value?: string): EmployeePerformanceSortBy {
  const normalized = String(value ?? "revenue").trim().toLowerCase();
  if (normalized === "utilization" || normalized === "bookings" || normalized === "revenue") {
    return normalized;
  }
  return "revenue";
}

function normalizeSortOrder(value?: string): EmployeePerformanceSortOrder {
  return String(value ?? "desc").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function normalizePositiveInt(value: unknown, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function normalizeOptional(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
