import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { clockWindowsOf, InserterTimetableRecord, rangesOfWindowPart, recordTimetable, timetableOf, WindowRange } from "./timetable";
import { runClockOnBuild } from "./trial";

/**
 * The timetable reads, in each tick after the inserters' update (simulation/tick-phases.ts): whether the inserter's phase
 * rule read its enable condition in the tick and what the read gave, the hand's phase and what it holds as the update left
 * them, and the window from the inserter's clock for this tick. A tick is needed where the read let the hand go on and the
 * hand is at its pickup after the update: it starts a hand, fills on, or waits with a part hand for its machine (counted
 * apart, as `wait`).
 */

/** One copy of a gear build: one taker of an iron plate lane into an assembler, its gears into a chest */
function gearConfig(lane: Record<string, unknown>, crafting_speed = 1.25): Config {
    return ConfigSchema.parse({
        setpoint: { item: "iron-gear-wheel", items_per_second: 2.5, copies: 1, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, position: { x: 1.5, y: -4 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, ...lane }] }],
        chests: [{ type: "buffer-chest", id: 1, storage_size: 4800, item_filter: "iron-gear-wheel" }],
    }) as Config;
}

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const T = 120;
const CYCLES = 30;

/** The records of a run of the gear build on the windows given, a window cycle of `T` ticks, and the windows as the timetable reads them */
function recorded(config: Config, windows: Record<string, [number, number]>): { records: InserterTimetableRecord[]; ranges: Record<string, WindowRange[]> } {
    const ranges = new Map(Object.entries(windows).map(([id, [start, end]]): [string, OpenRange[]] => [id, [OpenRange.from(start, end)]]));
    let records: () => InserterTimetableRecord[] = () => [];
    runClockOnBuild({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, ranges, T, quiet, {
        simulate_window_cycles: CYCLES, record_histories: false, factorio_states: false,
        on_context: context => { records = recordTimetable(context); },
    });
    return { records: records(), ranges: Object.fromEntries(Object.entries(windows).map(([id, [start, end]]) => [id, [{ start, end }]])) };
}

/** The timetable over the second half of the run */
function lineOf(config: Config, windows: Record<string, [number, number]>) {
    const { records, ranges } = recorded(config, windows);
    const last = Math.min(...records.map(it => it.last_tick));
    return timetableOf({ records, windows: ranges, window_cycle_ticks: T, from: last - 10 * T, to: last, needed_from: 0 });
}

describe("the timetable of a run", () => {
    it("lines every open tick up with a window of the clock, and counts each opening once", () => {
        const line = lineOf(gearConfig({ lane_end: { kind: "infinite" } }), { "inserter:1": [0, 30], "inserter:2": [40, 60] });
        expect(line.errors).toEqual([]);
        expect(line.no_window).toEqual([]);
        for (const row of line.rows) {
            expect(row.unmapped_open_ticks, row.inserter_id).toBe(0);
            expect(row.copies).toEqual([1]);
            expect(row.windows).toHaveLength(1);
            expect(row.windows[0].openings).toBe(10);
        }
        expect(line.rows.find(it => it.inserter_id === "inserter:1")!.windows[0]).toMatchObject({ start: 0, ticks: 31, open_ticks: 310 });
    });

    it("shows open ticks with no pickup in a window wider than its pickups", () => {
        // a lane that never runs short and a machine that is soon full: the hand takes its plates early in the window, then waits
        const line = lineOf(gearConfig({ lane_end: { kind: "infinite" } }), { "inserter:1": [0, 100], "inserter:2": [40, 60] });
        const window = line.rows.find(it => it.inserter_id === "inserter:1")!.windows[0];
        expect(window.needed).not.toBeNull();
        expect(window.needed_ticks).toBeGreaterThan(0);
        expect(window.open_without_pickup).toBeGreaterThan(0);
        expect(window.needed_ticks + window.open_without_pickup).toBe(window.open_ticks);
        // the needed ticks lie inside the window, and start in it: the hand begins its first hand in the window's first ticks
        expect(window.needed![0]).toBeGreaterThanOrEqual(0);
        expect(window.needed![1]).toBeLessThan(window.ticks);
        expect(window.needed![1]).toBeLessThan(100);
        expect(window.needed_by.start).toBeGreaterThan(0);
        expect(window.cut_hands).toBe(0);
        // from the run's start the needed ticks cover at least those of the span
        expect(window.needed_from_start![0]).toBeLessThanOrEqual(window.needed![0]);
        expect(window.needed_from_start![1]).toBeGreaterThanOrEqual(window.needed![1]);
    });

    it("shows a cut hand where the window closes on a filling hand, with its ticks to the swing in a later window", () => {
        // a dead end fed far below what the hand takes: a short window closes while the hand still waits for plates
        const line = lineOf(gearConfig({ lane_end: { kind: "dead_end" }, supply_rate: 2 }), { "inserter:1": [0, 10], "inserter:2": [0, 119] });
        const window = line.rows.find(it => it.inserter_id === "inserter:1")!.windows[0];
        expect(window.cut_hands).toBeGreaterThan(0);
        // the needed ticks run to the close: the hand fills on until it. A hand asleep at the empty lane makes no read, so
        // the ticks it sleeps through are open ticks with no pickup
        expect(window.needed).toEqual([0, 10]);
        expect(window.needed_ticks + window.open_without_pickup).toBe(window.open_ticks);
        const swung = Object.entries(window.ticks_to_swing).reduce((sum, [, hands]) => sum + hands, 0);
        expect(swung + window.not_swung).toBe(window.cut_hands);
        expect(swung).toBeGreaterThan(0);
        expect(Object.keys(window.ticks_to_swing).every(ticks => Number(ticks) >= 0 && Number(ticks) <= 11 * CYCLES)).toBe(true);
    });

    it("changes nothing in the run, and its record of the hand is the run's", () => {
        const config = { ...gearConfig({ lane_end: { kind: "dead_end" }, supply_rate: 2 }), overrides: { derive_clock_windows: false } } as Config;
        const ranges = new Map([["inserter:1", [OpenRange.from(0, 10)]], ["inserter:2", [OpenRange.from(0, 119)]]]);
        const hands = (record: boolean) => {
            let records: () => InserterTimetableRecord[] = () => [];
            const run = runClockOnBuild(config, ranges, T, quiet, { simulate_window_cycles: CYCLES, record_histories: false, factorio_states: false,
                machine_stock: true, stock_detail: "hands", ...(record && { on_context: context => { records = recordTimetable(context); } }) });
            return { stock: run.machine_stock!, records: records() };
        };
        const without = hands(false);
        const with_record = hands(true);
        expect(with_record.stock).toEqual(without.stock);
        // the stock's last tick is the record's: the record holds the warm-up before the stock too
        for (const series of with_record.stock.inserters) {
            const record = with_record.records.find(it => it.inserter_id === series.inserter_id)!;
            const shift = record.last_tick - (with_record.stock.ticks - 1);
            expect(series.held.every((held, index) => record.heldAt(index + shift) === held)).toBe(true);
        }
    });

    it("gives an inserter with no window of the clock a row of its own", () => {
        const line = lineOf(gearConfig({ lane_end: { kind: "infinite" } }), { "inserter:1": [0, 30] });
        expect(line.no_window).toEqual(["inserter:2"]);
        expect(line.rows.map(it => it.inserter_id)).toEqual(["inserter:1"]);
    });
});

describe("the windows of a clock as the timetable names them", () => {
    it("joins ranges that meet, and the range at the end of the window cycle with the one at its start", () => {
        expect(clockWindowsOf([{ start: 10, end: 20 }, { start: 21, end: 30 }, { start: 50, end: 60 }], 100)).toEqual([{ start: 10, ticks: 21 }, { start: 50, ticks: 11 }]);
        expect(clockWindowsOf([{ start: 0, end: 5 }, { start: 40, end: 50 }, { start: 90, end: 99 }], 100)).toEqual([{ start: 40, ticks: 11 }, { start: 90, ticks: 16 }]);
        expect(clockWindowsOf([], 100)).toEqual([]);
    });

    it("narrows a window to a part of it, in two ranges where the part runs over the end of the window cycle", () => {
        expect(rangesOfWindowPart({ start: 40, ticks: 11 }, 2, 6, 100)).toEqual([{ start: 42, end: 46 }]);
        expect(rangesOfWindowPart({ start: 90, ticks: 16 }, 3, 12, 100)).toEqual([{ start: 93, end: 99 }, { start: 0, end: 2 }]);
        expect(rangesOfWindowPart({ start: 90, ticks: 16 }, 11, 14, 100)).toEqual([{ start: 1, end: 4 }]);
    });
});
