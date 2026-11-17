import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { Logger } from "../common/logger";
import type { SerializableClockWindows } from "./clock";
import { narrowedWindows, repeatCheckOf, sharedSourcesOf } from "./repeat-check";
import type { TimetableLine } from "./timetable";

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const T = 120;

/** One copy of a gear build: an iron plate lane into an assembler; `takers` output inserters take its gears, each into a chest of its own */
function gearConfig(takers = 1): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 2.5, copies: 1, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, position: { x: 0.5, y: 0.5 } },
            ...Array.from({ length: takers }, (_, index) => ({ id: 2 + index, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 + index }, stack_size: 4,
                position: { x: index - 0.5, y: -4 } })),
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, lane_end: { kind: "infinite" } }] }],
        chests: Array.from({ length: takers }, (_, index) => ({ type: "buffer-chest", id: 1 + index, storage_size: 4800, item_filter: "iron-gear-wheel" })),
    }) as Config;
}

const runOf = (config: Config, windows: SerializableClockWindows) => ({ config, windows, window_cycle_ticks: T, expected_output_items: 25, long_run_ticks: 40 * T, swings: {} });

describe("the repeat check", () => {
    it("finds that a clock narrowed to the ticks its run needed repeats the run, on a build with no shared source", () => {
        const config = gearConfig();
        const check = repeatCheckOf(runOf(config, { "inserter:1": [{ start: 0, end: 100 }], "inserter:2": [{ start: 30, end: 90 }] }), null, quiet);
        expect(check.shared_sources).toEqual({ machine_with_takers: false, taken_in_one_tick: false });
        expect(check.control_repeats).toBe(true);
        expect(check.windows.narrowed).toBeGreaterThan(0);
        expect(check.earlier_by).toBe(0);
        expect(check.first_difference).toBeNull();
        expect(check.runs).toBe(3);
    });

    it("finds that it does not repeat where two takers take from one machine and a moved opening edge changes which takes first", () => {
        // two takers of the gears with the same window, which the update order decides between (the inserter that joined the update
        // list last is updated first). Narrowed, the two windows no longer open together, and the takes of the two change
        // (simulator: the first difference at tick 105, a hand of 3 gears where the first run had 4; it repeats with the windows
        // opened 16 ticks earlier)
        const config = gearConfig(2);
        const windows = { "inserter:1": [{ start: 0, end: 100 }], "inserter:2": [{ start: 20, end: 110 }], "inserter:3": [{ start: 20, end: 110 }] };
        const check = repeatCheckOf(runOf(config, windows), null, quiet);
        expect(check.shared_sources).toEqual({ machine_with_takers: true, taken_in_one_tick: true });
        expect(check.control_repeats).toBe(true);
        expect(check.first_difference).not.toBeNull();
        expect(["inserter:2", "inserter:3"]).toContain(check.first_difference!.inserter_id);
        expect(check.earlier_by).toBe(16);
    });
});

describe("the shared sources of a build", () => {
    it("tells a machine two inserters take from, and takers of one source whose windows meet", () => {
        const config = gearConfig(2);
        expect(sharedSourcesOf(config, { "inserter:2": [{ start: 0, end: 10 }], "inserter:3": [{ start: 20, end: 30 }] }, T))
            .toEqual({ machine_with_takers: true, taken_in_one_tick: false });
        expect(sharedSourcesOf(config, { "inserter:2": [{ start: 0, end: 10 }], "inserter:3": [{ start: 10, end: 30 }] }, T))
            .toEqual({ machine_with_takers: true, taken_in_one_tick: true });
        // an inserter with no window is always enabled
        expect(sharedSourcesOf(config, { "inserter:2": [{ start: 0, end: 10 }] }, T).taken_in_one_tick).toBe(true);
    });
});

describe("the windows narrowed to the needed ticks", () => {
    const line = (needed: Record<string, ([number, number] | null)[]>): TimetableLine => ({ from_tick: 0, to_tick: 0, no_window: [], errors: [],
        rows: Object.entries(needed).map(([inserter_id, windows]) => ({ inserter_id, copies: [1], unmapped_open_ticks: 0,
            windows: windows.map(needed_from_start => ({ start: 0, ticks: 0, openings: 0, open_ticks: 0, needed: null, needed_ticks: 0, needed_by: { start: 0, fill: 0, wait: 0 },
                open_without_pickup: 0, cut_hands: 0, cut_empty: 0, ticks_to_swing: {}, not_swung: 0, needed_from_start })) })) });

    it("narrows each window to its span, opens it earlier by the ticks asked but never before its own opening, and keeps one with no needed tick", () => {
        const windows = { "inserter:1": [{ start: 10, end: 30 }, { start: 50, end: 60 }], "inserter:2": [{ start: 0, end: 5 }, { start: 100, end: 119 }] };
        const needed = line({ "inserter:1": [[4, 9], null], "inserter:2": [[18, 25]] });
        expect(narrowedWindows(windows, needed, T, 0)).toEqual({ "inserter:1": [{ start: 14, end: 19 }, { start: 50, end: 60 }], "inserter:2": [{ start: 118, end: 119 }, { start: 0, end: 5 }].sort((a, b) => a.start - b.start) });
        expect(narrowedWindows(windows, needed, T, 2)["inserter:1"]).toEqual([{ start: 12, end: 19 }, { start: 50, end: 60 }]);
        expect(narrowedWindows(windows, needed, T, 9)["inserter:1"]).toEqual([{ start: 10, end: 19 }, { start: 50, end: 60 }]);
        // a window whose needed ticks fill it is not narrowed: the inserter keeps its ranges as they are
        expect(narrowedWindows(windows, line({ "inserter:1": [[0, 20], [0, 10]] }), T, 0)["inserter:1"]).toBe(windows["inserter:1"]);
    });
});
