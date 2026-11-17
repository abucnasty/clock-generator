import { describe, expect, it } from "vitest";
import { Duration, OpenRange } from "../../data-types";
import type { EnableControlOverrideConfig } from "../../config/schema";
import { TickProvider } from "../../simulation/current-tick-provider";
import { AlwaysEnabledControl, EnableControl } from "../../simulation/controls/enable-control";
import { SimulationContext } from "../sequence/simulation-context";
import { steelHub } from "../container-output.fixture";
import { WarmupStep } from "./steps/warmup-step";
import { InstalledControl, warmUpRepeatOf } from "./warm-up-repeat";

const clock = (window_cycle_ticks: number, options: { start_latency_ticks?: number; exact_subtick_positions?: boolean } = {}): InstalledControl => ({
    control: EnableControl.clocked({ windowCycleDuration: Duration.ofTicks(window_cycle_ticks), enabledRanges: [OpenRange.from(0, 1)],
        tickProvider: TickProvider.mutable(0), ...options }),
    override: { mode: "CLOCKED", ranges: [{ start: 0, end: 1 }], window_cycle_ticks },
});
const condition = { operator: "AND" as const, rules: [{ left: { type: "CONSTANT" as const, value: 1 }, operator: ">" as const, right: { type: "CONSTANT" as const, value: 0 } }] };
const conditional = (latched: boolean): InstalledControl => ({
    control: EnableControl.lambda(() => true),
    override: { mode: "CONDITIONAL", rule_set: condition, ...(latched && { latch: { release: condition } }) } as EnableControlOverrideConfig,
});
const always: InstalledControl = { control: AlwaysEnabledControl, override: { mode: "ALWAYS" } };

describe("where the warm-up may stop on a repeated state", () => {
    it("is every window cycle on a build clocked throughout on it, keyed from where its clocks' start is no longer dark", () => {
        expect(warmUpRepeatOf(60, [clock(60, { start_latency_ticks: 2 }), always], 600)).toEqual({ armed: true, bin_ticks: 60, keyed_from_ticks: 2 });
        expect(warmUpRepeatOf(60, [clock(60), always], 600)).toEqual({ armed: true, bin_ticks: 60, keyed_from_ticks: 0 });
    });

    it("is the whole-tick repeat of a window cycle of p/q ticks, and the merge with the clocks of their own (fuel)", () => {
        // 640/3 ticks repeat in 640 whole ticks: 3 window cycles
        expect(warmUpRepeatOf(640 / 3, [clock(640 / 3)], 6400 / 3)).toEqual({ armed: true, bin_ticks: 640, keyed_from_ticks: 0 });
        // a fuel clock of 90 ticks of its own on a window cycle of 60: every 180 ticks
        expect(warmUpRepeatOf(60, [clock(60), clock(90)], 600)).toEqual({ armed: true, bin_ticks: 180, keyed_from_ticks: 0 });
    });

    it("holds an inserter that is not clocked where its control reads only what the key holds: an unlatched condition", () => {
        expect(warmUpRepeatOf(60, [clock(60), conditional(false)], 600)).toEqual({ armed: true, bin_ticks: 60, keyed_from_ticks: 0 });
    });

    it("is none where a control reads what the key does not hold, or a clock does not repeat in whole ticks before the warm-up ends", () => {
        expect(warmUpRepeatOf(60, [clock(60), conditional(true)], 600)).toEqual({ armed: false, reason: "latched" });
        // a control of the plan (AUTO): a count of hands allowed so far, closed over
        expect(warmUpRepeatOf(60, [clock(60), { control: EnableControl.lambda(() => true), override: { mode: "AUTO" } }], 600))
            .toEqual({ armed: false, reason: "planning control" });
        expect(warmUpRepeatOf(60, [{ control: EnableControl.latched({ base: AlwaysEnabledControl, release: AlwaysEnabledControl }), override: undefined }], 600))
            .toEqual({ armed: false, reason: "planning control" });
        expect(warmUpRepeatOf(640 / 3, [clock(640 / 3, { exact_subtick_positions: false })], 6400 / 3)).toEqual({ armed: false, reason: "inexact clock" });
        // half a tick on a billion: its whole-tick repeat is too large for a 32-bit counter
        expect(warmUpRepeatOf(1e9 + 0.5, [], 600)).toEqual({ armed: false, reason: "no whole-tick repeat" });
        expect(warmUpRepeatOf(60, [clock(60), clock(7 * 11 * 13)], 600)).toEqual({ armed: false, reason: "repeat past the warm-up" });
    });
});

describe("the warm-up's stop on a repeated state", () => {
    /** A warm-up of `asked` ticks whose key at a tick is `keyAt` of the ticks run so far */
    const warmUp = (asked: number, bin_ticks: number, keyAt: (ticks: number) => string, keyed_from_ticks?: number) => {
        const context = SimulationContext.fromConfig(steelHub());
        const start = context.tick_provider.getCurrentTick();
        const keyed: number[] = [];
        const step = new WarmupStep(context, Duration.ofTicks(asked), { bin_ticks, keyed_from_ticks, key: () => {
            const ticks = context.tick_provider.getCurrentTick() - start;
            keyed.push(ticks);
            return keyAt(ticks);
        } });
        step.execute();
        return { ticks_run: step.ticks_run, repeat_ticks: step.repeat_ticks, keyed };
    };

    it("stops at the repeat where the full warm-up would end a whole number of repeats later", () => {
        // the state settles at 60 and repeats every bin: the repeat is seen at 120, and 600 is a whole number of bins after it
        expect(warmUp(600, 60, ticks => ticks === 0 ? "cold" : "settled")).toEqual({ ticks_run: 120, repeat_ticks: 60, keyed: [0, 60, 120] });
    });

    it("runs on from the repeat to the tick a whole number of repeats before the end, which need not be a boundary", () => {
        // the state repeats every 2 bins from 60 on, seen at 180: 600 is 3 repeats after 240, where it stops
        expect(warmUp(600, 60, ticks => ticks === 0 ? "cold" : String((ticks / 60) % 2))).toEqual({ ticks_run: 240, repeat_ticks: 120, keyed: [0, 60, 120, 180] });
        // a window cycle of 640/3 ticks asked for 10 window cycles: 2134 whole ticks run in full, keyed every 640 ticks (its
        // whole-tick repeat). The repeat is seen at 1280: 2134 is one repeat after 1494, where it stops, keying nothing more
        expect(warmUp(6400 / 3, 640, ticks => ticks === 0 ? "cold" : "settled")).toEqual({ ticks_run: 1494, repeat_ticks: 640, keyed: [0, 640, 1280] });
    });

    it("keys no boundary before its first keyed tick", () => {
        // the cold state comes up again at 120; keyed from 0 the run would stop there
        expect(warmUp(600, 60, ticks => ticks % 120 === 0 ? "a" : "b")).toEqual({ ticks_run: 120, repeat_ticks: 120, keyed: [0, 60, 120] });
        // but the clocks' start left the first ticks dark: from 60 on, the repeat is seen at 180, and 600 is 3 repeats after 240
        expect(warmUp(600, 60, ticks => ticks % 120 === 0 ? "a" : "b", 2)).toEqual({ ticks_run: 240, repeat_ticks: 120, keyed: [60, 120, 180] });
    });

    it("runs the full warm-up where no state repeats", () => {
        expect(warmUp(600, 60, ticks => String(ticks))).toEqual({ ticks_run: 600, repeat_ticks: undefined, keyed: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540] });
    });
});
