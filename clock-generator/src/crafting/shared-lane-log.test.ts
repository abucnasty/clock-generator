import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { fraction } from "../data-types/fraction";
import { claimedStacksOf, clockLaneLoadOf, jobLaneLoadsOf, laneFillOf } from "./shared-lane-log";
import type { LaneRow } from "./shared-lane-model";

/** Copies of one taker of an iron plate lane into a gear assembler, its gears into a chest, the lane fed at the rate given */
function laneConfig(supply_rate: number, items_per_second = 1, copies = 3): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: items_per_second * copies, copies, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, position: { x: 1.5, y: -4 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, supply_rate, lane_end: { kind: "dead_end" } }] }],
        chests: [{ type: "buffer-chest", id: 1, storage_size: 48, item_filter: "iron-gear-wheel" }],
    }) as Config;
}

describe("the lane load of a job, from the config alone", () => {
    it("gives the copies times what one copy takes, over the supply of the lane", () => {
        // a gear takes 2 iron plates; one copy makes 1 a second, so it takes 2 a second; 3 copies take 6
        const [load] = jobLaneLoadsOf(laneConfig(8));
        expect(load).toMatchObject({ belt_id: 1, lanes: [1], items: ["iron-plate"], per_copy: false, copies: 3, items_per_second: 2, supply_per_second: 8 });
        expect(load.load).toBeCloseTo(0.75, 9);
        expect(load.against_one).toBe("below");
    });

    it("says exactly 1 only where the copies take exactly what the lane gets", () => {
        expect(jobLaneLoadsOf(laneConfig(6))[0].against_one).toBe("exactly");
        expect(jobLaneLoadsOf(laneConfig(5.99))[0].against_one).toBe("above");
    });
});

describe("the lane load of a clock, from the run of one copy alone", () => {
    const pickups = (ticks: number[], items = 4) => ticks.map(tick => ({ tick, item: "advanced-circuit", items }));

    it("averages the items one copy took over the whole window cycles of the span, against what the supply brings in one", () => {
        // a window cycle of 60 ticks; one copy takes 8 items in each of window cycles 2 and 3 (ticks 120 to 239); 3 copies; 30 a second bring 30 a window cycle
        const load = clockLaneLoadOf({ belt_id: 1, item: "advanced-circuit", lanes: [1], copies: 3, supply_per_second: fraction(30),
            taker_pickups: [pickups([100, 125, 130, 185, 190, 245])], window_cycle_ticks: 60, first_cycle: 2, end_cycle: 4 })!;
        expect([load.items_per_window_cycle, load.supply_per_window_cycle, load.window_cycles]).toEqual([8, 30, 2]);
        expect(load.load).toBeCloseTo(0.8, 9);
        expect(load.against_one).toBe("below");
    });

    it("says exactly 1 where the copies take all the supply brings", () => {
        const load = clockLaneLoadOf({ belt_id: 1, item: "advanced-circuit", lanes: [1], copies: 3, supply_per_second: fraction(24),
            taker_pickups: [pickups([125, 130, 185, 190])], window_cycle_ticks: 60, first_cycle: 2, end_cycle: 4 })!;
        expect([load.load, load.against_one]).toEqual([1, "exactly"]);
    });

    it("gives nothing for an empty span", () => {
        expect(clockLaneLoadOf({ belt_id: 1, item: "advanced-circuit", lanes: [1], copies: 3, supply_per_second: fraction(24),
            taker_pickups: [], window_cycle_ticks: 60, first_cycle: 2, end_cycle: 2 })).toBeNull();
    });
});

describe("the fill of a lane after each opening of its takers' windows", () => {
    it("gives, for each window, the longest fill and the openings not filled before the next window opens", () => {
        const fill = laneFillOf(1, "advanced-circuit", [1], [
            { window: 0, opens: 10, gap_ticks: 40, fill_ticks: 30, in_time: true },
            { window: 1, opens: 50, gap_ticks: 20, fill_ticks: 25.5, in_time: false },
            { window: 0, opens: 10, gap_ticks: 40, fill_ticks: 40, in_time: true },
            { window: 1, opens: 50, gap_ticks: 20, fill_ticks: 10, in_time: true },
        ], false);
        expect(fill).toEqual({ belt_id: 1, item: "advanced-circuit", lanes: [1], fills_in_time: false, windows: [
            { opens: 10, gap_ticks: 40, openings: 2, longest_fill_ticks: 40, openings_not_filled: 0 },
            { opens: 50, gap_ticks: 20, openings: 2, longest_fill_ticks: 25.5, openings_not_filled: 1 },
        ] });
    });
});

describe("the stacks the copies claim on a lane they share", () => {
    /** A row of `copies` copies of one taker `step` tiles apart, the first reach's downstream edge 2 tiles from the entry */
    const row = (copies: number, step: number): LaneRow => ({ belt_id: 1, lane: 1, length_tiles: 2 + step * (copies - 1), copies, flow: { x: 1, y: 0 },
        step_tiles: step, step_stated: true,
        takers: Array.from({ length: copies }, (_, copy) => ({ copy, inserter_id: "inserter:1", edge_tiles: 2 + copy * step, length_tiles: 1 })) });
    const moved = () => ({ open_ticks: 10, moved_ticks: 4 });
    // a belt that moves an eighth of a tile a tick: a stack (a quarter of a tile) passes a point in 2 ticks
    const claimed = (copies: number, step: number, phases: number[], window_cycle_ticks = 100) => claimedStacksOf({ row: row(copies, step), item: "advanced-circuit",
        spacing: "copy_offset", tiles_per_tick: 0.125, window_cycle_ticks, phases: new Map([["inserter:1", phases]]), takers_without_windows: [], moved });

    it("finds no claim where the travel to the next copy moves the pickups away from each other on the window cycle", () => {
        // 6 tiles at 0.125 a tile a tick: 48 ticks of travel; pickups at 10: copy 2 meets stacks copy 1 saw at 10 - 48 = -38, that is 62
        const stacks = claimed(2, 6, [10]);
        expect(stacks.stack_ticks).toBe(2);
        expect(stacks.copies).toEqual([
            { copy: 1, travel_ticks: 0, pickups: 1, claimed: 0, open_ticks: 10, moved_ticks: 4 },
            { copy: 2, travel_ticks: 48, pickups: 1, claimed: 0, open_ticks: 10, moved_ticks: 4 },
        ]);
    });

    it("finds a claim where the travel is a whole window cycle: copy 2 waits for the stacks copy 1 took", () => {
        // 12.5 tiles: 100 ticks of travel, one window cycle
        expect(claimed(2, 12.5, [10, 20]).copies.map(it => it.claimed)).toEqual([0, 2]);
        // one tick off is within one stack's passing time; two ticks off is not
        expect(claimed(2, 12.625, [10]).copies[1].claimed).toBe(1);
        expect(claimed(2, 12.75, [10]).copies[1].claimed).toBe(0);
    });

    it("finds a claim for the pickups of a window that runs over the end of the window cycle", () => {
        // one window from 90 to 10: pickups at 95 and 5. Copy 1 takes at 95; copy 2 takes at 5, 10 tiles of travel at 0.125 = 80 ticks: 5 - 95 - 80 = -170, that is 30 on a cycle of 100.
        // At 1.25 tiles (10 ticks): 5 - 95 - 10 = -100, that is 0: copy 2 claims what copy 1 took in the window cycle before
        expect(claimed(2, 10, [95, 5]).copies[1].claimed).toBe(0);
        expect(claimed(2, 1.25, [95, 5]).copies[1].claimed).toBe(1);
    });

    it("counts a claim of any earlier copy, and gives each copy's travel from copy 1", () => {
        const stacks = claimed(3, 6.25, [10]);
        // copy 2: 50 ticks; copy 3: 100 ticks from copy 1, a whole window cycle
        expect(stacks.copies.map(it => [it.travel_ticks, it.claimed])).toEqual([[0, 0], [50, 0], [100, 1]]);
    });
});
