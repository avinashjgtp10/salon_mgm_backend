import { maskPhone } from "./mask.util";

describe("maskPhone", () => {
  it("keeps only the last 4 digits", () => {
    expect(maskPhone("912424232434")).toBe("********2434");
    expect(maskPhone("+91 98765-43210")).toBe("********3210");
  });
  it("fully masks short or empty values", () => {
    expect(maskPhone("123")).toBe("****");
    expect(maskPhone(undefined)).toBe("****");
  });
});
