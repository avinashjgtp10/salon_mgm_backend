import { CLIENT_CODE_PREFIX, formatClientCode, NEXT_CLIENT_NUMBER_SQL } from "./clientCode";

describe("formatClientCode", () => {
    it("pads to three digits behind the CL prefix", () => {
        expect(formatClientCode(1)).toBe("CL001");
        expect(formatClientCode(9)).toBe("CL009");
        expect(formatClientCode(42)).toBe("CL042");
        expect(formatClientCode(999)).toBe("CL999");
    });

    it("keeps growing past three digits instead of wrapping or truncating", () => {
        expect(formatClientCode(1000)).toBe("CL1000");
        expect(formatClientCode(12345)).toBe("CL12345");
    });

    it("always matches the CL000 shape", () => {
        for (const n of [1, 10, 100, 999, 1000, 99999]) {
            expect(formatClientCode(n)).toMatch(new RegExp(`^${CLIENT_CODE_PREFIX}[0-9]{3,}$`));
        }
    });
});

describe("NEXT_CLIENT_NUMBER_SQL", () => {
    it("is scoped to one salon and counts both CL-style and plain-number codes", () => {
        expect(NEXT_CLIENT_NUMBER_SQL).toContain("salon_id = $1");
        expect(NEXT_CLIENT_NUMBER_SQL).toContain("^[0-9]{1,9}$");
        expect(NEXT_CLIENT_NUMBER_SQL).toContain("^CL[0-9]{1,9}$");
    });
});
