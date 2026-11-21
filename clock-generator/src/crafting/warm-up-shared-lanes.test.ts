import { describe, expect, it, vi } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import { runOnSharedLanes, sharedLaneLayoutOf } from "./shared-lane-model";
import * as state from "./runner/steady-state";
import { WarmupStep } from "./runner/steps/warmup-step";

/**
 * Copies of a gear build on one lane they share, to a dead end: each takes 10 plates in one swing a window cycle of 120
 * ticks and makes 5 gears of them into an infinity chest, so its machine and hands can repeat every window cycle.
 * `plates_per_second` is the lane's supply for each copy.
 */
function gearCopies(plates_per_second: number, copies = 2): Config {
    return ConfigSchema.parse({
        setpoint: { item: "iron-gear-wheel", items_per_second: 2.5 * copies, copies, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, position: { x: 0.5, y: -2 } }],
        inserters: [
            { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 10, position: { x: 0.5, y: 0.5 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 5, position: { x: 1.5, y: -4 } },
        ],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 2, lane_end: { kind: "dead_end" },
            supply_rate: plates_per_second * copies }] }],
        chests: [{ type: "infinity-chest", id: 1, item_filter: [], remove_unfiltered_items: true }],
    }) as Config;
}

const WINDOW_CYCLE = 120;
const RECORDED_WINDOW_CYCLES = 6;
const windows = new Map([["inserter:1", [OpenRange.from(0, 30)]], ["inserter:2", [OpenRange.from(0, 119)]]]);

/**
 * A run of the copies after its warm-up of 10 window cycles (1,200 ticks): the ticks the warm-up ran, each lane's key at
 * the end of the run, and the hands each taker put down in the recorded window cycles, by tick of the recorded run. With
 * `unstopped`, every state key differs, so the warm-up never stops and runs in full.
 */
function run(config: Config, unstopped = false) {
    const warm_ups: number[] = [];
    const execute = WarmupStep.prototype.execute;
    const warm_up = vi.spyOn(WarmupStep.prototype, "execute").mockImplementation(function (this: WarmupStep) {
        execute.call(this);
        warm_ups.push(this.ticks_run);
    });
    const keys = unstopped ? vi.spyOn(state, "simulationStateKey").mockImplementation(context => `tick ${context.tick_provider.getCurrentTick()}`) : undefined;
    try {
        const layout = sharedLaneLayoutOf(config, [{ belt_id: 1, lane: 1, flow: { x: 1, y: 0 }, shared: true }]);
        const model = runOnSharedLanes(config, windows, WINDOW_CYCLE, layout, RECORDED_WINDOW_CYCLES, quiet);
        const last_tick = Math.max(...model.takers.map(taker => taker.last_tick));
        const first_tick = last_tick - RECORDED_WINDOW_CYCLES * WINDOW_CYCLE;
        model.lanes.forEach(lane => lane.advanceTo(last_tick));
        return {
            warm_up_ticks: warm_ups[0],
            lanes: model.lanes.map(lane => lane.key()),
            hands: model.takers.map(taker => taker.hands.filter(hand => hand.tick > first_tick).map(hand => ({ ...hand, tick: hand.tick - first_tick }))),
        };
    } finally {
        keys?.mockRestore();
        warm_up.mockRestore();
    }
}

describe("the warm-up of a run of the copies keys the lanes they share", () => {
    it("runs on where the machines and hands repeat but a shared lane does not: the run after it is the run after the full warm-up", () => {
        // 4.9 plates a second for each copy, which takes 5: the lane runs short a little every window cycle, from its
        // dead end back, while the stacks in reach of each taker stand where they stood (the machines and hands repeat
        // from the third window cycle). The lane does not repeat within the warm-up, so it runs in full.
        const config = gearCopies(4.9);
        const full = run(config, true);
        expect(full.warm_up_ticks).toBe(1200);
        const stopped = run(config);
        expect(stopped.warm_up_ticks).toBe(1200);
        expect(stopped.lanes).toEqual(full.lanes);
        expect(stopped.hands).toEqual(full.hands);
    });

    it("stops where the lanes repeat too, in the state the full warm-up ends in", () => {
        // 5.5 plates a second for each copy: the lane stays full to its entry and repeats with the machines and hands
        const config = gearCopies(5.5);
        const full = run(config, true);
        const stopped = run(config);
        expect(stopped.warm_up_ticks).toBe(360);
        expect(stopped.lanes).toEqual(full.lanes);
        expect(stopped.hands).toEqual(full.hands);
    });
});
