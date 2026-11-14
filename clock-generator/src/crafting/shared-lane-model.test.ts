import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { FlowDirection } from "../entities/traits/lane-facts";
import { SharedLaneLayout, sharedLaneLayoutOf, runOnSharedLanes } from "./shared-lane-model";
import { runClockOnBuild } from "./trial";

/** One copy: two takers of one belt lane, 12 tiles apart, and a machine for each */
function rowConfig(setpoint: Partial<Config["setpoint"]>, lane: Record<string, unknown> = {}): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "processing-unit", items_per_second: 1, copies: 1, ...setpoint },
        machines: [
            { id: 1, recipe: "processing-unit", productivity: 0, crafting_speed: 1, position: { x: 0.5, y: -2 } },
            { id: 2, recipe: "processing-unit", productivity: 0, crafting_speed: 1, position: { x: 12.5, y: -2 } },
        ],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 2 }, position: { x: 12.5, y: 0.5 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "advanced-circuit", stack_size: 4, ...lane }] }],
        chests: [],
    }) as Config;
}

/** Lane 1 of belt 1 laid out, its items moving `flow`, shared by the copies or not */
const rowsOf = (config: Config, flow: FlowDirection, shared = true) => sharedLaneLayoutOf(config, [{ belt_id: 1, lane: 1, flow, shared }]);

describe("the lanes the copies share, laid out as rows", () => {
    it("stands the copies copy_offset apart downstream of the copy of the config, the reaches a tile long beside each inserter", () => {
        const [row] = rowsOf(rowConfig({ copies: 3, copy_offset: { x: 18, y: 0 } }), { x: 1, y: 0 }).rows;
        expect(row).toMatchObject({ belt_id: 1, lane: 1, copies: 3 });
        // the entry a tile upstream of the first reach, which spans the inserter's tile, 0 to 1
        expect(row.takers.map(taker => [taker.copy, taker.inserter_id, taker.edge_tiles])).toEqual([
            [0, "inserter:1", 2], [0, "inserter:2", 14], [1, "inserter:1", 20], [1, "inserter:2", 32], [2, "inserter:1", 38], [2, "inserter:2", 50],
        ]);
        expect(row.takers.every(taker => taker.length_tiles === 1)).toBe(true);
        expect(row.length_tiles).toBe(50);
    });

    it("reads the copy order along the flow: against it, the inserters of a copy stand the other way round", () => {
        const [row] = rowsOf(rowConfig({ copies: 2, copy_offset: { x: 18, y: 0 } }), { x: -1, y: 0 }).rows;
        expect(row.takers.map(taker => [taker.copy, taker.inserter_id, taker.edge_tiles])).toEqual([
            [0, "inserter:2", 2], [0, "inserter:1", 14], [1, "inserter:2", 20], [1, "inserter:1", 32],
        ]);
    });

    it("gives a part copy its part of the takers, rounded up for each, the ones furthest upstream, with the machines they feed", () => {
        const layout = rowsOf(rowConfig({ copies: 2.5, copy_offset: { x: 18, y: 0 } }), { x: 1, y: 0 });
        expect(layout.rows[0].copies).toBe(3);
        expect(layout.rows[0].takers.filter(taker => taker.copy === 2).map(taker => taker.inserter_id)).toEqual(["inserter:1"]);
        // a whole copy, then the part copy: inserter 1, the machine it feeds and the belt
        expect(layout.copies.later.map(holds => holds === "whole" ? holds : [...holds].sort())).toEqual(["whole", ["belt:1", "inserter:1", "machine:1"]]);
    });

    it("stands the copies end to end, the copy's length from its positions, where copy_offset is unset", () => {
        const [row] = rowsOf(rowConfig({ copies: 2 }), { x: 1, y: 0 }).rows;
        // the positions span 0.5 to 12.5 along the flow: a copy of 13 tiles
        expect(row.takers.filter(taker => taker.copy === 1).map(taker => taker.edge_tiles)).toEqual([15, 27]);
    });

    /** The config without the positions of its inserters, its machines of the prototypes given (none: no prototype) */
    const unplaced = (config: Config, prototypes: (string | undefined)[] = []): Config => ({ ...config,
        machines: config.machines.map((machine, index) => prototypes[index] === undefined ? machine : { ...machine, prototype: prototypes[index] }),
        inserters: config.inserters.map(({ position: _p, ...inserter }) => inserter) });
    const placed = (config: Config) => rowsOf(config, { x: 1, y: 0 }).rows[0].takers.map(taker => [taker.copy, taker.inserter_id, taker.edge_tiles]);

    it("stands the takers of a config without positions a tile apart, and the copies the longer side of its widest machine apart", () => {
        // an assembling machine 3 is 3 tiles across, an electromagnetic plant 4
        expect(placed(unplaced(rowConfig({ copies: 2 }), ["assembling-machine-3", "electromagnetic-plant"]))).toEqual([
            [0, "inserter:1", 2], [0, "inserter:2", 3], [1, "inserter:1", 6], [1, "inserter:2", 7],
        ]);
    });

    it("stands the copies the smallest machine of the game data apart where no machine has a known size, and never under a tile a taker", () => {
        const config = unplaced(rowConfig({ copies: 2 }));
        // a stone furnace and a burner mining drill are 2 tiles across
        expect(placed({ ...config, inserters: config.inserters.slice(0, 1) })).toEqual([[0, "inserter:1", 2], [1, "inserter:1", 4]]);
        const third = { id: 3, source: { type: "belt" as const, id: 1 }, sink: { type: "machine" as const, id: 2 } };
        expect(placed({ ...config, inserters: [...config.inserters, third] })).toEqual([
            [0, "inserter:1", 2], [0, "inserter:2", 3], [0, "inserter:3", 4], [1, "inserter:1", 5], [1, "inserter:2", 6], [1, "inserter:3", 7],
        ]);
    });

    it("lays out the takers of the config's copy alone on a lane the copies do not share, and builds no other copy", () => {
        const layout = rowsOf(rowConfig({ copies: 3, copy_offset: { x: 18, y: 0 } }), { x: 1, y: 0 }, false);
        expect(layout.rows[0].takers.map(taker => taker.copy)).toEqual([0, 0]);
        expect(layout.copies.later).toEqual([]);
    });

    it("needs no copy spacing along a lane the copies do not share, or with one copy: the lane may run across copy_offset", () => {
        const south = { x: 0, y: 1 };
        expect(rowsOf(rowConfig({ copies: 3, copy_offset: { x: 18, y: 0 } }), south, false).rows[0].takers.map(taker => taker.copy)).toEqual([0, 0]);
        expect(rowsOf(rowConfig({ copies: 1, copy_offset: { x: 18, y: 0 } }), south, true).rows[0].takers.map(taker => taker.copy)).toEqual([0, 0]);
    });

    it("asks for the copy spacing along a lane that several copies share", () => {
        expect(() => rowsOf(rowConfig({ copies: 3, copy_offset: { x: 18, y: 0 } }), { x: 0, y: 1 })).toThrow("The copies on lane 1 of belt 1 need copy_offset along the lane");
        expect(() => rowsOf(rowConfig({ copies: 3, copy_offset: { x: 0, y: 0 } }), { x: 1, y: 0 })).toThrow("The copies on lane 1 of belt 1 need copy_offset along the lane");
    });
});

/** One copy of a gear build: one taker of an iron plate lane into an assembler, its gears into a chest */
function gearConfig(lane: Record<string, unknown>, copies = 1): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 2.5 * copies, copies, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, position: { x: 1.5, y: -4 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, ...lane }] }],
        chests: [{ type: "buffer-chest", id: 1, storage_size: 48, item_filter: "iron-gear-wheel" }],
    }) as Config;
}

const gearWindows = new Map([
    ["inserter:1", [OpenRange.from(0, 30)]],
    ["inserter:2", [OpenRange.from(40, 60)]],
]);
const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

/** The hands inserter 1 of the simulated copy put down in a run of the gear build, with the model's rows or without */
function handsOfTaker(config: Config, layout: SharedLaneLayout | null): string {
    if (layout !== null) {
        const model = runOnSharedLanes(config, gearWindows, 120, layout, 30, quiet);
        return JSON.stringify(model.takers.find(taker => taker.copy === 0 && taker.inserter_id === "inserter:1")!.hands
            .map(({ tick, items }) => ({ tick, items })));
    }
    const hands: { tick: number; items: number }[] = [];
    runClockOnBuild({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, gearWindows, 120, quiet, {
        simulate_window_cycles: 30, record_histories: false, factorio_states: false,
        on_context: context => {
            const state = context.inserters.find(inserter => inserter.entity_id.id === "inserter:1")!.inserter_state;
            let dropped = state.items_dropped;
            context.after_inserters.push({ tick: () => {
                if (state.items_dropped > dropped) hands.push({ tick: context.tick_provider.getCurrentTick(), items: state.items_dropped - dropped });
                dropped = state.items_dropped;
            } });
        },
    });
    return JSON.stringify(hands);
}

describe("the model run with one copy and one taker on the lane", () => {
    it.each([[{ lane_end: { kind: "dead_end" } }], [{ lane_end: { kind: "infinite" } }]])("gives the hands of the run without it (%j)", lane => {
        const config = gearConfig(lane);
        expect(handsOfTaker(config, rowsOf(config, { x: 1, y: 0 }))).toBe(handsOfTaker(config, null));
    });
});

describe("the model run with copies in a row", () => {
    it("runs every copy with its own machine on the lane, and a dead end fed below what the copies take leaves the last copy short", () => {
        const config = gearConfig({ lane_end: { kind: "dead_end" }, supply_rate: 6 }, 4);
        const model = runOnSharedLanes(config, gearWindows, 120, rowsOf(config, { x: 1, y: 0 }), 30, quiet);
        const items = (copy: number) => model.takers.find(taker => taker.copy === copy)!.hands.reduce((sum, hand) => sum + hand.items, 0);
        expect(model.takers.map(taker => taker.copy)).toEqual([0, 1, 2, 3]);
        expect(items(3)).toBeLessThan(items(0));
        // what the takers took is what stood on the lane at the start and came on since, less what is on it at the end,
        // give or take what the hands hold at the end
        const lane = model.lanes[0], taken = items(0) + items(1) + items(2) + items(3);
        expect(lane.initial + lane.supplied - lane.items() - taken).toBeGreaterThanOrEqual(0);
        expect(lane.initial + lane.supplied - lane.items() - taken).toBeLessThanOrEqual(4 * 16);
    });
});
