import { describe, expect, it } from "vitest";
import { Duration, OpenRange } from "../data-types";
import { TickProvider } from "../simulation/current-tick-provider";
import { EnableControl } from "../simulation/controls/enable-control";
import { subtickClockForWindowCycle, windowOfTicks, windowTicks, withWindowsAtLeast, withWindowsKeepingLength, withWindowsLengthened } from "./clock";
import { evenlySpacedOutputWindows, paddedWindows } from "./candidates/transforms";
import { movedOutputSwingCandidates } from "./candidates/moved-output-swing";
import { shiftedCycleCandidates } from "./candidates/phase-shifted-batch";

// The production science rebuild at 231 a second: a window cycle of 38400/77 ticks, a subtick clock of 38400 ticks read in
// 1/77 ticks. A window [s, e] is open in the whole ticks whose position is in it, so a window read off whole ticks covers
// e - s + 1 ticks only in the window cycle that starts on a whole tick.
const WINDOW_CYCLE = 38400 / 77;
const { window_cycle_ticks: P, scale: Q } = subtickClockForWindowCycle(WINDOW_CYCLE)!;

/**
 * How long a clock of the game stays open each time it opens on these windows, over its whole counter (a window carried
 * over the end of the window cycle is one opening, the counter's end too): for one window, its ticks in each window cycle
 */
function openTicksPerWindowCycle(ranges: OpenRange[], window_cycle_ticks: number = WINDOW_CYCLE): number[] {
    const ticks = subtickClockForWindowCycle(window_cycle_ticks)!.window_cycle_ticks;
    const tick_provider = TickProvider.mutable(0);
    const clock = EnableControl.clocked({ windowCycleDuration: Duration.ofTicks(window_cycle_ticks), enabledRanges: ranges, tickProvider: tick_provider, is_game_clock: true });
    const open = Array.from({ length: ticks }, (_, tick) => { tick_provider.setCurrentTick(tick); return clock.isEnabled(); });
    // start counting at a closed tick, so that no opening is cut in two
    const from = open.indexOf(false);
    const runs: number[] = [];
    let run = 0;
    for (let i = 1; i <= ticks; i++) {
        if (open[(from + i) % ticks]) {
            run++;
        } else if (run > 0) {
            runs.push(run);
            run = 0;
        }
    }
    return runs;
}

const every = (ticks: number) => new Array<number>(Q).fill(ticks);

describe("a window on a fractional window cycle", () => {
    it("read off whole ticks is a tick short in every window cycle but the one that starts on a whole tick", () => {
        const open = openTicksPerWindowCycle([OpenRange.from(2, 26)]);
        expect(open.filter(it => it === 25)).toHaveLength(1);
        expect(open.filter(it => it === 24)).toHaveLength(Q - 1);
    });

    it("made in the clock's positions covers its ticks in every window cycle", () => {
        expect(windowOfTicks(2, 25, WINDOW_CYCLE)).toEqual(OpenRange.from(2, 27 - 1 / Q));
        expect(openTicksPerWindowCycle([windowOfTicks(2, 25, WINDOW_CYCLE)])).toEqual(every(25));
        // a start between whole ticks too
        expect(openTicksPerWindowCycle([windowOfTicks(100 + 5 / Q, 13, WINDOW_CYCLE)])).toEqual(every(13));
    });

    it("has the length it was read with, whether read off whole ticks or made in positions", () => {
        expect(windowTicks(OpenRange.from(2, 26), WINDOW_CYCLE)).toBe(25);
        expect(windowTicks(windowOfTicks(2, 25, WINDOW_CYCLE), WINDOW_CYCLE)).toBe(25);
        expect(windowTicks(OpenRange.from(2, 26), 500)).toBe(25);
    });

    it("keeps its length across the end of the window cycle", () => {
        const kept = withWindowsKeepingLength(new Map([["inserter:1", [OpenRange.from(0, 4), OpenRange.from(490, WINDOW_CYCLE)]]]), WINDOW_CYCLE).get("inserter:1")!;
        // 490 to the end and 0 to 4: one window of (P - 490 Q) + 4 Q + 1 = 979 positions, which covers 13 ticks at most
        expect(openTicksPerWindowCycle(kept)).toEqual(every(13));
    });

    it("is the same window when kept twice", () => {
        const windows = new Map([["inserter:1", [OpenRange.from(2, 26), OpenRange.from(169, 181)]]]);
        const once = withWindowsKeepingLength(windows, WINDOW_CYCLE);
        expect(withWindowsKeepingLength(once, WINDOW_CYCLE)).toEqual(once);
    });

    it("is left as it is on a whole-tick window cycle", () => {
        const windows = new Map([["inserter:1", [OpenRange.from(2, 26)]]]);
        expect(withWindowsKeepingLength(windows, 500)).toBe(windows);
    });
});

describe("lengthening windows on a fractional window cycle", () => {
    it("adds the ticks in every window cycle", () => {
        const lengthened = withWindowsLengthened(new Map([["inserter:5", [OpenRange.from(35, 57)]]]), new Map([["inserter:5", 4]]), WINDOW_CYCLE);
        expect(openTicksPerWindowCycle(lengthened.get("inserter:5")!)).toEqual(every(23 + 4));
    });

    it("lengthens a window already lengthened from the length it has", () => {
        const windows = new Map([["inserter:5", [OpenRange.from(35, 57)]]]);
        const twice = withWindowsLengthened(withWindowsLengthened(windows, new Map([["inserter:5", 4]]), WINDOW_CYCLE), new Map([["inserter:5", 3]]), WINDOW_CYCLE);
        expect(twice).toEqual(withWindowsLengthened(windows, new Map([["inserter:5", 7]]), WINDOW_CYCLE));
    });

    it("carries a window over the end of the window cycle", () => {
        const lengthened = withWindowsLengthened(new Map([["inserter:5", [OpenRange.from(490, 497)]]]), new Map([["inserter:5", 10]]), WINDOW_CYCLE);
        expect(openTicksPerWindowCycle(lengthened.get("inserter:5")!)).toEqual(every(18));
    });

    it("makes a short window last at least the ticks given in every window cycle, and keeps a longer one's length", () => {
        const windows = new Map([["inserter:2", [OpenRange.from(1, 8), OpenRange.from(25, 46)]]]);
        const at_least = withWindowsAtLeast(windows, new Map([["inserter:2", 10]]), WINDOW_CYCLE).get("inserter:2")!;
        expect(openTicksPerWindowCycle([at_least[0]])).toEqual(every(10));
        expect(openTicksPerWindowCycle([at_least[1]])).toEqual(every(22));
    });

    it("leaves a fractional window cycle with no subtick clock as it is", () => {
        const windows = new Map([["inserter:2", [OpenRange.from(1, 8)]]]);
        // no p/q with q up to 1000 is within the tolerance of 100 + 1/1009
        const no_subtick = 100 + 1 / 1009;
        expect(subtickClockForWindowCycle(no_subtick)).toBeNull();
        expect(withWindowsLengthened(windows, new Map([["inserter:2", 4]]), no_subtick).get("inserter:2")).toBe(windows.get("inserter:2"));
        expect(withWindowsAtLeast(windows, new Map([["inserter:2", 10]]), no_subtick).get("inserter:2")).toBe(windows.get("inserter:2"));
    });
});

describe("the transforms of a search on a fractional window cycle", () => {
    it("pads a window by whole ticks in every window cycle, up to the end of the window cycle", () => {
        const padded = paddedWindows(new Map([["inserter:3", [OpenRange.from(2, 66), OpenRange.from(490, 495)]]]), ["inserter:3"], 3, WINDOW_CYCLE).get("inserter:3")!;
        expect(openTicksPerWindowCycle([padded[0]])).toEqual(every(65 + 3));
        // 490 to 498 and the last position: 9 ticks in the window cycles whose last position is past tick 498, else 8
        expect(padded[1].end_inclusive).toBeCloseTo((P - 1) / Q, 9);
    });

    it("spaces the output windows evenly in the clock's positions, each as long in every window cycle", () => {
        const output = new Map([["inserter:1", [OpenRange.from(2, 26), OpenRange.from(169, 181), OpenRange.from(252, 276), OpenRange.from(418, 430)]]]);
        const even = evenlySpacedOutputWindows(output, new Map([["inserter:1", 4]]), WINDOW_CYCLE)!.get("inserter:1")!;
        expect(even).toHaveLength(4);
        // the shortest window, 13 ticks, less the 2 ticks of circuit latency
        for (const window of even) {
            expect(openTicksPerWindowCycle([window])).toEqual(every(11));
        }
        // a quarter of the window cycle apart, to the nearest position
        expect(even.map(it => Math.round(it.start_inclusive * Q))).toEqual([0, 1, 2, 3].map(k => 2 * Q + Math.round(k * P / 4)));
    });

    it("moves an output swing in whole ticks, every window keeping its length", () => {
        const output = withWindowsKeepingLength(new Map([["inserter:1", [OpenRange.from(2, 26), OpenRange.from(169, 192), OpenRange.from(417, 441)]]]), WINDOW_CYCLE);
        const candidates = movedOutputSwingCandidates(output, WINDOW_CYCLE, 6);
        expect(candidates.length).toBeGreaterThan(0);
        for (const candidate of candidates) {
            expect(Number.isInteger(candidate.shift_ticks)).toBe(true);
            const ranges = candidate.output_windows.get("inserter:1")!;
            expect(ranges.map(range => openTicksPerWindowCycle([range])[0])).toEqual([25, 24, 25]);
            // no moved window runs past the end of the window cycle
            expect(Math.max(...ranges.map(range => range.end_inclusive))).toBeLessThan(WINDOW_CYCLE);
        }
    });

    it("shifts a crafting cycle's windows together in whole ticks, every window keeping its length", () => {
        // two crafting cycles of 249.35 ticks: the output and an input window in each
        const planned = withWindowsKeepingLength(new Map([
            ["inserter:1", [OpenRange.from(2, 26), OpenRange.from(252, 276)]],
            ["inserter:3", [OpenRange.from(30, 90), OpenRange.from(280, 340)]],
        ]), WINDOW_CYCLE);
        const candidates = shiftedCycleCandidates(planned, WINDOW_CYCLE / 2, WINDOW_CYCLE);
        expect(candidates.some(it => it.selectable)).toBe(true);
        for (const candidate of candidates) {
            expect(Number.isInteger(candidate.shift_ticks)).toBe(true);
            expect(candidate.windows.get("inserter:1")!.map(range => openTicksPerWindowCycle([range])[0])).toEqual([25, 25]);
            expect(candidate.windows.get("inserter:3")!.map(range => openTicksPerWindowCycle([range])[0])).toEqual([61, 61]);
            expect(Math.max(...candidate.windows.get("inserter:3")!.map(range => range.end_inclusive))).toBeLessThan(WINDOW_CYCLE);
        }
    });
});

it("uses the exact reduced period for subtick eligibility", () => {
    const exact = (numerator: number, denominator: number) =>
        subtickClockForWindowCycle(numerator / denominator, { numerator, denominator });
    expect(exact(105, 4)).toEqual({ window_cycle_ticks: 105, scale: 4 });
    expect(exact(10499999999, 100000000)).toBeNull();
    expect(exact(1002, 1001)).toBeNull();
    expect(exact(1073741825, 2)).toBeNull();
    expect(exact(1073741823, 2)).toEqual({ window_cycle_ticks: 1073741823, scale: 2 });
});
