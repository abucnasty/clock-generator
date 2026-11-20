import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { inserterEnds } from "./inserter-counters";
import { runClockOnBuild } from "./trial";
import { ledgerOfStock, wakeUpsCountOf } from "./wake-ledger";
import { ghostWakeUpsOfStock, wakeUpsOfStock } from "./wake-ups";

/** One copy of a gear build: an iron plate lane into an assembler, its gears into a second assembler's chest feed */
function gearConfig(): Config {
    return ConfigSchema.parse({
        setpoint: { item: "iron-gear-wheel", items_per_second: 2.5, copies: 1, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, position: { x: 1.5, y: -4 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, lane_end: { kind: "infinite" } }] }],
        chests: [{ type: "buffer-chest", id: 1, storage_size: 4800, item_filter: "iron-gear-wheel" }],
        overrides: { derive_clock_windows: false },
    }) as Config;
}

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

describe("the ledger of a clock's wakeups", () => {
    // windows that leave the output inserter asleep on its machine when its window closes: wakeups, ghosts among them
    const config = gearConfig();
    const windows = new Map([["inserter:1", [OpenRange.from(0, 40)]], ["inserter:2", [OpenRange.from(10, 25), OpenRange.from(70, 80)]]]);
    const stock = runClockOnBuild(config, windows, 120, quiet, { simulate_window_cycles: 40, record_histories: false, factorio_states: false,
        machine_stock: true, stock_detail: "wake-ups" }).machine_stock!;
    const ends = inserterEnds(config);
    const from = 20 * 120;
    const ledger = ledgerOfStock(stock, ends, from);
    const counted = wakeUpsOfStock(stock, ends, from);

    it("adds up to the wakeups the record counts over the same ticks, the same a minute", () => {
        expect(ledger.wake_ups).toBeGreaterThan(0);
        expect(ledger.ticks).toBe(counted.ticks);
        expect(ledger.wake_ups_per_minute).toBe(counted.wake_ups_per_minute);
        expect(wakeUpsCountOf(counted.wake_ups_per_minute, counted.ticks)).toBe(ledger.wake_ups);
        const by_rows = ledger.rows.reduce((sum, row) => sum + row.input.machine + row.input.inserter + row.output.machine + row.output.inserter, 0);
        expect(by_rows).toBe(ledger.wake_ups);
        // each inserter's lists add up to its own count
        for (const row of ledger.rows) {
            const own = counted.inserters.find(it => it.inserter_id === row.inserter_id)!;
            expect((row.input.machine + row.input.inserter) * 3600 / counted.ticks).toBeCloseTo(own.input_wake_ups_per_minute, 9);
            expect((row.output.machine + row.output.inserter) * 3600 / counted.ticks).toBeCloseTo(own.output_wake_ups_per_minute, 9);
        }
    });

    it("keeps the ghost wakeups apart, as many as the run has, each one of the wakeups counted", () => {
        const ghosts = ghostWakeUpsOfStock(stock, ends, from);
        expect(ghosts.length).toBeGreaterThan(0);
        const in_ledger = ledger.rows.reduce((sum, row) => sum + row.ghost.input + row.ghost.output, 0);
        expect(in_ledger).toBe(ghosts.length);
        for (const row of ledger.rows) {
            expect(row.ghost.input).toBeLessThanOrEqual(row.input.machine + row.input.inserter);
            expect(row.ghost.output).toBeLessThanOrEqual(row.output.machine + row.output.inserter);
        }
    });

    it("counts the ticks an enabled inserter waits with an empty hand at its source", () => {
        const output = ledger.rows.find(it => it.inserter_id === "inserter:2")!;
        expect(output.empty_hand_enabled_ticks.pickup + output.empty_hand_enabled_ticks.rest).toBeGreaterThan(0);
        // never more than the ticks counted
        for (const row of ledger.rows) expect(row.empty_hand_enabled_ticks.pickup + row.empty_hand_enabled_ticks.rest).toBeLessThanOrEqual(ledger.ticks);
    });
});
