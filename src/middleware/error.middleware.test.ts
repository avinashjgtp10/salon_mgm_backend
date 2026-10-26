jest.mock("../config/logger", () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import logger from "../config/logger";
import { AppError, errorHandler } from "./error.middleware";

function call(err: Error) {
  const res: any = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const req: any = { path: "/clients/1", url: "/clients/1?phone=999", method: "POST", requestId: "rid-1" };
  errorHandler(err, req, res, jest.fn());
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe("errorHandler logging", () => {
  it("logs expected 4xx AppErrors as warn with requestId and no query string", () => {
    const res = call(new AppError(403, "Forbidden", "FORBIDDEN"));
    expect(logger.log).toHaveBeenCalledWith("warn", "AppError: Forbidden", expect.objectContaining({
      requestId: "rid-1", statusCode: 403, url: "/clients/1",
    }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.locals.errorLogged).toBe(true);
  });

  it("logs 5xx AppErrors as error", () => {
    call(new AppError(502, "Upstream down", "UPSTREAM"));
    expect(logger.log).toHaveBeenCalledWith("error", "AppError: Upstream down", expect.any(Object));
  });

  it("logs unexpected errors with stack trace and still returns 500", () => {
    const res = call(new Error("boom"));
    expect(logger.error).toHaveBeenCalledWith("Unhandled error: boom", expect.objectContaining({
      requestId: "rid-1", stack: expect.stringContaining("boom"),
    }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
