import { describe, expect, it } from "vitest";
import { compareBy } from "./compare-by";

describe("compareBy", () => {
    type Pair = { first: number; second: number };
    const compare = compareBy<Pair>(it => it.first, it => it.second);

    it("lets the first key that differs decide, the smaller first", () => {
        expect(compare({ first: 1, second: 9 }, { first: 2, second: 0 })).toBe(-1);
        expect(compare({ first: 2, second: 0 }, { first: 1, second: 9 })).toBe(1);
        expect(compare({ first: 1, second: 3 }, { first: 1, second: 2 })).toBe(1);
    });

    it("compares Infinity on both sides as equal and goes on to the next key", () => {
        expect(compare({ first: Infinity, second: 1 }, { first: Infinity, second: 2 })).toBe(-1);
        expect(compare({ first: Infinity, second: 0 }, { first: 5, second: 0 })).toBe(1);
    });

    it("is 0 when every key is equal, and with no key", () => {
        expect(compare({ first: 4, second: Infinity }, { first: 4, second: Infinity })).toBe(0);
        expect(compareBy<Pair>()({ first: 1, second: 1 }, { first: 2, second: 2 })).toBe(0);
    });
});
