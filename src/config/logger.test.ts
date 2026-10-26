import Transport from "winston-transport";
import logger from "./logger";

// Regression: logger.error("msg:", err?.message) used to spread the string into
// {"0":"c","1":"o",...}, so the actual error text never reached Papertrail.
const captured: any[] = [];
class Capture extends Transport {
  log(info: any, cb: () => void) {
    captured.push(info);
    cb();
  }
}

beforeAll(() => {
  logger.clear();
  logger.add(new Capture());
});
beforeEach(() => (captured.length = 0));

describe("logger", () => {
  it("keeps a string second argument in the message instead of spreading it", () => {
    logger.error("[X] Job error:", "connection refused");
    expect(captured[0].message).toBe("[X] Job error: connection refused");
    expect(captured[0]["0"]).toBeUndefined();
  });

  it("appends several primitive arguments", () => {
    logger.warn("[X] a", "b", 3);
    expect(captured[0].message).toBe("[X] a b 3");
  });

  it("still merges object metadata", () => {
    logger.error("[X] obj", { error: "e1", requestId: "r1" });
    expect(captured[0]).toMatchObject({ message: "[X] obj", error: "e1", requestId: "r1" });
  });

  it("still interpolates %s placeholders", () => {
    logger.info("hello %s", "world");
    expect(captured[0].message).toBe("hello world");
  });

  it("keeps the stack for Error arguments", () => {
    logger.error("[X] failed", new Error("boom"));
    expect(captured[0].stack).toContain("boom");
  });

  it("tolerates undefined arguments", () => {
    logger.error("[X] no detail", undefined);
    expect(captured[0].message).toBe("[X] no detail");
  });
});
