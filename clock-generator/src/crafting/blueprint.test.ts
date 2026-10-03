import { describe, it, expect } from "vitest";
import { OpenRange } from "../data-types";
import { moduloSignalRanges, splitRepeatingRanges } from "./blueprint";

/** Replays the circuit: the clock reads `tick % period`, the modulo combinator one tick later */
function enabledTicksMatch(ranges: OpenRange[], period: number): boolean {
    const split = splitRepeatingRanges(ranges, period);
    if (!split) {
        return true;
    }
    const modulo_ranges = moduloSignalRanges(split.repeating, split.modulus);
    const inAny = (rs: OpenRange[], value: number) => rs.some(r => r.contains(value));
    for (let tick = period; tick < 3 * period; tick++) {
        const clock = tick % period;
        const modulo = ((tick - 1) % period) % split.modulus;
        const expected = inAny(ranges, clock);
        const actual = inAny(modulo_ranges, modulo) || inAny(split.remaining, clock);
        if (expected !== actual) {
            return false;
        }
    }
    return true;
}

function windowsEvery(spacing: number, length: number, period: number, offset = 0): OpenRange[] {
    const ranges: OpenRange[] = [];
    for (let start = offset; start < period; start += spacing) {
        ranges.push(OpenRange.from(start, Math.min(start + length - 1, period - 1)));
    }
    return ranges;
}

describe("splitRepeatingRanges", () => {
    it("checks windows repeating every crafting cycle against the clock modulo the cycle", () => {
        const ranges = windowsEvery(48, 5, 5808, 10);
        const split = splitRepeatingRanges(ranges, 5808);
        expect(split).toEqual({ modulus: 48, repeating: [OpenRange.from(10, 14)], remaining: [] });
        expect(enabledTicksMatch(ranges, 5808)).toBe(true);
    });

    it("keeps the windows that do not repeat as clock windows", () => {
        const ranges = OpenRange.reduceRanges([...windowsEvery(48, 4, 960, 2), OpenRange.from(100, 110), OpenRange.from(500, 503)]);
        const split = splitRepeatingRanges(ranges, 960)!;
        expect(split.modulus).toBe(48);
        expect(split.remaining.length).toBeGreaterThan(0);
        expect(enabledTicksMatch(ranges, 960)).toBe(true);
    });

    it("handles windows starting at the period boundary, where the modulo signal wraps", () => {
        const ranges = windowsEvery(24, 3, 480, 0);
        expect(splitRepeatingRanges(ranges, 480)?.modulus).toBe(24);
        expect(enabledTicksMatch(ranges, 480)).toBe(true);
    });

    it("leaves windows without a repeating pattern alone", () => {
        expect(splitRepeatingRanges([OpenRange.from(3, 9), OpenRange.from(40, 47), OpenRange.from(200, 210)], 480)).toBeNull();
    });

    it("leaves fractional periods alone", () => {
        expect(splitRepeatingRanges(windowsEvery(24, 3, 480), 480.5)).toBeNull();
    });

    it("matches the windows tick for tick for irregular patterns", () => {
        let seed = 7;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (let trial = 0; trial < 40; trial++) {
            const period = [96, 240, 528, 960][trial % 4];
            const base = windowsEvery([12, 24, 48][trial % 3], 1 + Math.floor(random() * 6), period, Math.floor(random() * 12));
            const extra = Array.from({ length: 3 }, () => {
                const start = Math.floor(random() * (period - 5));
                return OpenRange.from(start, start + Math.floor(random() * 5));
            });
            const dropped = base.filter(() => random() > 0.1);
            expect(enabledTicksMatch(OpenRange.reduceRanges([...dropped, ...extra]), period)).toBe(true);
        }
    });
});
