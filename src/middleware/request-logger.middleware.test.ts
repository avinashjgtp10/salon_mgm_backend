import { EventEmitter } from "events";

jest.mock("../config/logger", () => ({
  __esModule: true,
  default: { log: jest.fn() },
}));

import logger from "../config/logger";
import { requestLogLevel, requestLogger } from "./request-logger.middleware";

const opts = { sampleRate: 0, slowMs: 3000 };

describe("requestLogLevel", () => {
  it("does not log fast successful requests by default", () => {
    expect(requestLogLevel(200, 20, opts)).toBeNull();
    expect(requestLogLevel(304, 20, opts)).toBeNull();
  });

  it("always logs server errors as error", () => {
    expect(requestLogLevel(500, 5, opts)).toBe("error");
    expect(requestLogLevel(503, 5, opts)).toBe("error");
  });

  it("keeps auth/permission/rate-limit failures as warn", () => {
    for (const s of [401, 403, 429]) expect(requestLogLevel(s, 5, opts)).toBe("warn");
  });

  it("keeps other 4xx (validation, not found) as info", () => {
    expect(requestLogLevel(400, 5, opts)).toBe("info");
    expect(requestLogLevel(404, 5, opts)).toBe("info");
  });

  it("warns on slow requests even when successful", () => {
    expect(requestLogLevel(200, 3500, opts)).toBe("warn");
  });

  it("samples successful requests when configured", () => {
    expect(requestLogLevel(200, 5, { ...opts, sampleRate: 0.1, random: 0.05 })).toBe("info");
    expect(requestLogLevel(200, 5, { ...opts, sampleRate: 0.1, random: 0.5 })).toBeNull();
  });
});

describe("requestLogger middleware", () => {
  const logMock = logger.log as unknown as jest.Mock;

  function run(opt: { status: number; path?: string; header?: string; errorLogged?: boolean }) {
    const res: any = new EventEmitter();
    res.statusCode = opt.status;
    res.locals = { errorLogged: opt.errorLogged };
    res.setHeader = jest.fn();
    const req: any = {
      method: "GET",
      path: opt.path ?? "/clients/abc",
      originalUrl: `${opt.path ?? "/clients/abc"}?phone=9999999999&token=secret`,
      baseUrl: "/api/v1",
      route: { path: "/clients/:id" },
      header: (n: string) => (n === "x-request-id" ? opt.header : undefined),
    };
    const next = jest.fn();
    requestLogger(req, res, next);
    res.emit("finish");
    return { req, res, next };
  }

  beforeEach(() => logMock.mockClear());

  it("sets a request id header and calls next", () => {
    const { res, next, req } = run({ status: 200 });
    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
  });

  it("honours a safe inbound request id and rejects an unsafe one", () => {
    expect(run({ status: 200, header: "abc-123" }).req.requestId).toBe("abc-123");
    expect(run({ status: 200, header: "bad id\nx" }).req.requestId).not.toBe("bad id\nx");
  });

  it("logs a 500 with route pattern, no query string or ids", () => {
    run({ status: 500 });
    const [level, , meta] = logMock.mock.calls[0];
    expect(level).toBe("error");
    expect(meta).toMatchObject({ method: "GET", route: "/api/v1/clients/:id", status: 500 });
    expect(JSON.stringify(meta)).not.toMatch(/secret|9999999999|abc/);
  });

  it("does not log successful requests or /health", () => {
    run({ status: 200 });
    run({ status: 500, path: "/health" });
    expect(logMock).not.toHaveBeenCalled();
  });

  it("skips failures the error handler already logged", () => {
    run({ status: 400, errorLogged: true });
    expect(logMock).not.toHaveBeenCalled();
  });
});
