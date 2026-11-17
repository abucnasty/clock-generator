import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { FlowDirection } from "../entities/traits/lane-facts";
import { InserterPhase } from "../simulation/status-codes";
import { handStartsOf, openingsOf, recordHandConditions, TakerConditions, waitedFor } from "./hand-conditions";
import { runOnSharedLanes, sharedLaneLayoutOf } from "./shared-lane-model";

/**
 * Each condition is read in each tick after the inserters' update and before the machines' update (simulation/tick-phases.ts):
 * the window from the inserter's control for that tick; the hand's phase and what it holds as its update left them; the
 * sink as the machines' update of the tick before and every inserter of this tick left it; the reach as the lane stands in
 * this tick, after every take of this tick, with a take of the hand itself counted as an item there.
 */

/** One copy of a gear build: one taker of an iron plate lane into an assembler, its gears into a chest */
function gearConfig(lane: Record<string, unknown>, chest_size = 48, crafting_speed = 1.25): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 2.5, copies: 1, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16, position: { x: 1.5, y: -4 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4, ...lane }] }],
        chests: [{ type: "buffer-chest", id: 1, storage_size: chest_size, item_filter: "iron-gear-wheel" }],
    }) as Config;
}

const quiet = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const east: FlowDirection = { x: 1, y: 0 };
const T = 120;

/** The record of inserter 1 in a run of the gear build on the windows given, a window cycle of `T` ticks */
function recorded(config: Config, windows: Record<string, [number, number]>, cycles = 20): TakerConditions {
    const layout = sharedLaneLayoutOf(config, [{ belt_id: 1, lane: 1, flow: east, shared: true }]);
    const ranges = new Map(Object.entries(windows).map(([id, [start, end]]): [string, OpenRange[]] => [id, [OpenRange.from(start, end)]]));
    let records: () => TakerConditions[] = () => [];
    runOnSharedLanes(config, ranges, T, layout, cycles, quiet, context => {
        records = recordHandConditions(context, config, new Set(["0|inserter:1"]));
    });
    return records()[0];
}

const ALL = Number.MAX_SAFE_INTEGER;

describe("the conditions a hand of a belt taker waits for", () => {
    it("records every tick of the run for the taker named, with its lane, its window read from its clock", () => {
        const record = recorded(gearConfig({ lane_end: { kind: "infinite" } }), { "inserter:1": [0, 30], "inserter:2": [40, 60] });
        expect([record.copy, record.inserter_id, record.window_read, record.lanes]).toEqual([0, "inserter:1", true, [1]]);
        expect(record.last_tick - record.first_tick + 1).toBeGreaterThanOrEqual(20 * T - 1);
        // the window is open 31 ticks of each window cycle
        const open = Array.from({ length: T }, (_, i) => record.windowOpen(5 * T + i)).filter(Boolean).length;
        expect(open).toBe(31);
    });

    it("gives the window as the last condition of a hand that waits for its window to open", () => {
        // a lane that never runs short, a machine that always has room: the hand waits at its source for the window
        const record = recorded(gearConfig({ lane_end: { kind: "infinite" } }), { "inserter:1": [0, 30], "inserter:2": [40, 60] });
        const starts = handStartsOf(record, 4 * T, ALL);
        const at_opening = starts.filter(start => record.windowOpen(start.tick) && !record.windowOpen(start.tick - 1));
        expect(at_opening.length).toBeGreaterThan(0);
        expect(at_opening.every(start => start.last === "window_open")).toBe(true);
    });

    it("gives the hand's return as the last condition of a hand that starts again as soon as its arm is back", () => {
        // a machine that crafts far faster than the hand brings its plates always has room for the next hand
        const record = recorded(gearConfig({ lane_end: { kind: "infinite" } }, 48, 20), { "inserter:1": [0, 100], "inserter:2": [0, 119] });
        const starts = handStartsOf(record, 4 * T, ALL);
        const inside = starts.filter(start => record.windowOpen(start.tick - 1));
        expect(inside.length).toBeGreaterThan(0);
        expect(inside.some(start => start.last === "hand_at_source")).toBe(true);
        // the arm was away the tick before
        for (const start of inside.filter(it => it.last === "hand_at_source")) expect(record.has(start.tick - 1, "hand_at_source")).toBe(false);
    });

    it("gives the item as what an empty hand waits for at an empty lane", () => {
        // a dead end fed far below what the hand takes: the lane empties, and the hand waits at its source with room in the machine
        const record = recorded(gearConfig({ lane_end: { kind: "dead_end" }, supply_rate: 2 }), { "inserter:1": [0, 60], "inserter:2": [0, 119] }, 40);
        const closes = openingsOf(record, 20 * T, ALL);
        expect(closes.length).toBeGreaterThan(0);
        expect(closes.filter(it => it.at_close === "item_there").length).toBeGreaterThan(0);
        const starts = handStartsOf(record, 20 * T, ALL);
        expect(starts.some(start => start.last === "item_there")).toBe(true);
        // an empty hand at an empty lane leaves ticks where the item is the one condition missing
        const waits = Array.from({ length: 10 * T }, (_, i) => 20 * T + i).filter(tick => record.windowOpen(tick) && waitedFor(record, tick) === "item_there");
        expect(waits.length).toBeGreaterThan(0);
    });

    it("gives the room at the sink as what a hand waits for at a machine whose output is full", () => {
        // the output inserter takes a few ticks a window cycle into a chest that fills: the machine's output reaches its block
        const record = recorded(gearConfig({ lane_end: { kind: "infinite" } }, 16), { "inserter:1": [0, 100], "inserter:2": [110, 111] }, 30);
        const closes = openingsOf(record, 10 * T, ALL);
        expect(closes.length).toBeGreaterThan(0);
        expect(closes.every(it => it.at_close === "room_at_sink")).toBe(true);
    });

    it("gives the item, not the sink, for an empty hand at an empty lane that still has its wait for the sink set", () => {
        // the wait flag of the hand is set where it found its machine taking nothing, and cleared only when it starts a
        // pickup or is disabled: here it is set by hand on an empty hand at an empty lane whose machine takes again
        const config = gearConfig({ lane_end: { kind: "dead_end" }, supply_rate: 2 });
        const layout = sharedLaneLayoutOf(config, [{ belt_id: 1, lane: 1, flow: east, shared: true }]);
        let records: () => TakerConditions[] = () => [];
        let flagged = 0;
        const tick_of: number[] = [];
        runOnSharedLanes(config, new Map([["inserter:1", [OpenRange.from(0, 60)]], ["inserter:2", [OpenRange.from(0, 119)]]]), T, layout, 30, quiet, context => {
            records = recordHandConditions(context, config, new Set(["0|inserter:1"]));
            const taker = context.inserters.find(it => it.entity_id.id === "inserter:1")!;
            context.after_inserters.unshift({ tick() {
                const state = taker.inserter_state;
                const tick = context.tick_provider.getCurrentTick();
                if (tick > 20 * T && state.held_item === null && taker.hand.phase === InserterPhase.PICKUP && taker.hand.drop.acceptsHand()
                    && taker.control.enabledIn(0) && !state.waits_for_sink) {
                    state.waits_for_sink = true;
                    flagged++;
                    tick_of.push(tick);
                }
            } });
        });
        const record = records()[0];
        expect(flagged).toBeGreaterThan(0);
        const waits = tick_of.map(tick => waitedFor(record, tick));
        expect(waits.filter(it => it === "item_there").length).toBeGreaterThan(0);
        expect(waits).not.toContain("room_at_sink");
    });
});
