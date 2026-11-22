import { describe, expect, it } from "vitest";
import { TargetProductionRateConfigSchema } from "./schema";

const parse = (items_per_second: unknown, copies = 1) =>
    TargetProductionRateConfigSchema.safeParse({ item: "iron-gear-wheel", items_per_second, copies });

describe("the total rate on the wire", () => {
    it.each([2, 2.5])("preserves the numeric payload %s", rate => {
        expect(parse(rate).data?.items_per_second).toBe(rate);
    });

    it("accepts and orders a reduced pair, including an explicit whole fraction", () => {
        for (const denominator of [7, 1]) {
            expect(JSON.stringify(parse({ denominator, numerator: 16 }).data?.items_per_second))
                .toBe(JSON.stringify({ numerator: 16, denominator }));
        }
    });

    it.each([0, -1, NaN, Infinity, "", "16/7", {}, { numerator: 1 }, { numerator: 1, denominator: 0 },
        { numerator: -1, denominator: 3 }, { numerator: 1.5, denominator: 2 }, { numerator: 1, denominator: 2 ** 53 },
        { numerator: 32, denominator: 14 }, { numerator: 16, denominator: 7, extra: true }])("rejects malformed rates", rate => {
        expect(parse(rate).success).toBe(false);
    });

    it("reports exact unit conversion precision at the rate field", () => {
        const pair = { numerator: 1, denominator: 100_000_000_000_000 };
        expect(parse(pair).success).toBe(true);
        for (const result of [parse(pair, 2), parse({ numerator: 1, denominator: Number.MAX_SAFE_INTEGER })]) {
            expect(result.error?.issues).toContainEqual(expect.objectContaining({ code: "custom", path: ["items_per_second"] }));
        }
    });
});
