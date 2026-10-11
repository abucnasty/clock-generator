import { beforeAll, describe, expect, it } from "vitest";
import { clockFromWindows, simulateClockOnly, type MachineStartStock, type SerializableClockWindows } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import type { StockRecording } from "./machine-stock";
import { SIMULATED_TICK_TO_CLOCK_POSITION } from "../verification/simulated-recording";
import { quiet } from "./generate-blueprint-test-helpers";

/** "26-47 74-95" as windows */
const windows = (text: string) => text.split(" ").map(range => {
    const [start, end] = range.split("-").map(Number);
    return { start, end };
});

/** Windows `length` ticks long, the first from `first`, one every `every` ticks of the period */
const evenly = (first: number, length: number, every: number, period: number) =>
    Array.from({ length: period / every }, (_, index) => ({ start: first + index * every, end: first + index * every + length - 1 }));

// One copy of the advanced circuit build of issue 98 (see clock-from-windows.test.ts for the build), under a clock with
// evenly spaced windows of 4 ticks for the inserters that take off a belt: one hand of electronic circuits every 33
// ticks, one of coal every 132, and 8 ticks every 24 for the advanced circuits.
//
// Recorded on the scaffold in Factorio 2.1.21 on 2026-10-10 for 36,000 ticks: 608 and 624 advanced circuits a period
// in turn, of 704. One electromagnetic plant (machine 2 of the config) finished its 352 products in every period, the
// other (machine 4) 264: its output stood at 12 after the output inserter had taken its hand, where the other's stood
// at 0, so it was over its output block of 21 for the ticks before every output window. An inserter whose window opened
// in those ticks waited, and took its items a tick after the output inserter had taken the block away; with windows
// as long as the hands they are made for, that tick cost the plastic inserter and the cable inserter a hand each time.
//
// Two rules of the game are in it, and the simulator had neither:
// - An inserter that waits for space in a machine acts in the tick after the one that wakes it (see
//   IdleModeTransitionEvaluator). Without it the simulator left this state within a period and made 352.
// - A machine whose output block is more than a stack of its product goes on taking ingredients with the stack full
//   (see OutputBlock.ingredients_blocked_at): the plastic plant, full at 100 plastic bars, took coal.
// With both, a run of the simulator that starts in the state the game was in at sample 59 of that recording holds
// what every machine and every inserter of the game held, tick for tick, for the 36,372 ticks the recording goes on.
describe("the advanced circuit build under evenly spaced windows of one hand", () => {
    const PERIOD = 528;
    const copper_cable = windows("26-47 74-95 122-143 170-191 218-239 266-287 314-335 362-383 410-431 458-479 506-519 522-527");
    const plastic = windows("29-42 77-82 173-186 221-234 269-282 317-330 365-370 461-474 509-522");
    const evenly_spaced: SerializableClockWindows = {
        "inserter:1": evenly(6, 4, 33, PERIOD), "inserter:8": evenly(6, 4, 33, PERIOD),
        "inserter:3": copper_cable, "inserter:7": copper_cable,
        "inserter:4": plastic, "inserter:6": plastic,
        "inserter:5": evenly(71, 4, 132, PERIOD),
        "inserter:2": evenly(10, 8, 24, PERIOD), "inserter:9": evenly(10, 8, 24, PERIOD),
    };

    // What the machines held at sample 59 of the recording, where every inserter was switched off with an empty hand
    // and back over its source, and the clock stood at 59. Both plants were 4490 ticks of progress into a craft, of
    // the 5760 a craft takes at 1601/5760 a tick, and their productivity bars half a product behind 1.75 times that.
    const EMP_PROGRESS = 4490 / 5760;
    const emp = (plastic_bars: number, cable: number, circuits: number, advanced_circuits: number): MachineStartStock => ({
        items: { "plastic-bar": plastic_bars, "copper-cable": cable, "electronic-circuit": circuits, "advanced-circuit": advanced_circuits },
        crafting_progress: EMP_PROGRESS,
        bonus_progress: 1.75 * EMP_PROGRESS - 0.5,
    });
    const foundry: MachineStartStock = { items: { "copper-cable": 200 }, crafting_progress: 1, bonus_progress: 0 };
    const recorded_state: Record<string, MachineStartStock> = {
        "machine:1": foundry,
        "machine:5": foundry,
        "machine:2": emp(42, 84, 10, 12),
        "machine:4": emp(10, 52, 10, 18),
        "machine:3": { items: { coal: 69, "plastic-bar": 100 }, crafting_progress: 1, bonus_progress: 1 },
    };
    const RECORDED_CLOCK_POSITION = 59;

    /** The windows as a run has to be given them for its first tick to read `position` of the clock */
    const startingAfter = (clock_windows: SerializableClockWindows, position: number): SerializableClockWindows => {
        const offset = ((SIMULATED_TICK_TO_CLOCK_POSITION - (position + 1)) % PERIOD + PERIOD) % PERIOD;
        return Object.fromEntries(Object.entries(clock_windows).map(([entity_id, ranges]) => [entity_id, ranges.flatMap(range => {
            const from = (range.start + offset) % PERIOD;
            const to = from + range.end - range.start;
            return to < PERIOD ? [{ start: from, end: to }] : [{ start: 0, end: to - PERIOD }, { start: from, end: PERIOD - 1 }];
        }).sort((a, b) => a.start - b.start)]));
    };

    let config: Config;
    let run: StockRecording;
    const PERIODS = 12;

    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT);
        config = { ...sample, overrides: { ...sample.overrides, terminal_swing_count: 2 } };
        run = simulateClockOnly(config, startingAfter(evenly_spaced, RECORDED_CLOCK_POSITION), PERIOD, PERIODS, quiet,
            { keep_output_buffers: true, warmup_periods: 0, start_stock: recorded_state });
    });

    // the periods are cut where the recorder cuts them, where the clock wraps: the run starts at position 60
    const FIRST_WRAP = PERIOD - (RECORDED_CLOCK_POSITION + 1);
    /** The first tick of each of the last `periods` whole clock periods of the run */
    const periodStarts = (periods: number): number[] => {
        const whole = Math.floor((PERIODS * PERIOD - FIRST_WRAP) / PERIOD);
        return Array.from({ length: periods }, (_, index) => FIRST_WRAP + (whole - periods + index) * PERIOD);
    };
    /** Items an inserter dropped in each of the last `periods` clock periods of the run */
    const dropped = (inserter_id: number, periods: number): number[] => {
        const held = run.inserters.find(it => it.inserter_id === `inserter:${inserter_id}`)!.held;
        return periodStarts(periods).map(from => {
            let items = 0;
            for (let tick = from; tick < from + PERIOD; tick++) {
                items += Math.max(0, held[tick - 1] - held[tick]);
            }
            return items;
        });
    };
    /** Products a machine finished in each of the last `periods` clock periods of the run */
    const finished = (machine_id: number, periods: number): number[] => {
        const products = run.machines.find(it => it.machine_id === `machine:${machine_id}`)!.products_finished;
        return periodStarts(periods).map(from => products[from + PERIOD - 1] - products[from - 1]);
    };
    const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

    it("stays in the state the game was recorded in: one plant makes its 352 a period and the other 264", () => {
        expect(finished(2, 4)).toEqual([352, 352, 352, 352]);
        expect(finished(4, 4)).toEqual([264, 264, 264, 264]);
        // the advanced circuits that leave: 352 from the one, 256 and 272 in turn from the other: 608 and 624 a period
        expect(dropped(2, 4)).toEqual([352, 352, 352, 352]);
        expect(sorted(dropped(9, 4))).toEqual([256, 256, 272, 272]);
    });

    it("moves what the game moved into the plant that falls behind: 192 of 256 plastic, 384 of 512 cable, 192 of 256 circuits a period", () => {
        expect(sorted(dropped(6, 4))).toEqual([176, 176, 208, 208]);
        expect(sorted(dropped(7, 4))).toEqual([368, 368, 400, 400]);
        expect(sorted(dropped(8, 4))).toEqual([176, 176, 208, 208]);
        // and all of it into the other
        expect(dropped(4, 4)).toEqual([256, 256, 256, 256]);
        expect(dropped(3, 4)).toEqual([512, 512, 512, 512]);
        expect(dropped(1, 4)).toEqual([256, 256, 256, 256]);
    });

    it("moves 56 of 64 coal a period into a plastic plant that is full, which finishes 224 of 256 products", () => {
        expect(sorted(dropped(5, 4))).toEqual([48, 48, 64, 64]);
        expect(sorted(finished(3, 4))).toEqual([216, 216, 232, 232]);
    });

    // Where the generator starts the clock, with the plants emptied of advanced circuits and filled with ingredients,
    // both plants hold 352: the simulator has both states, as the game has (its two plants were in one each), and
    // which one a plant ends up in is decided by what it holds when the clock starts. The as-built check does not
    // start a clock where the game's plant was, so it still passes this clock.
    it("holds 704 a period from the start the generator checks a clock from", () => {
        const made = clockFromWindows(config, evenly_spaced, PERIOD, quiet);
        expect(made.stability_check.as_built!.holds).toBe(true);
        expect(made.stability_check.as_built!.actual_output_items).toBe(704);
    });
});
