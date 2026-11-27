import fs from "fs";
import path from "path";
import {beforeAll, expect, test} from "vitest";
import {BackpressurePickupLane} from "./backpressure-pickup-lane";
import {Config} from "../config";
import {loadConfigFromFile} from "../config/loader";
import {withEveryLaneEnd} from "../entities/traits/lane-ends";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {bindHandPorts} from "../simulation/components/hand-ports";
import {EntityState} from "./entity-state";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";

interface Clip {
    name: string; layout: string; item: string; near_lane: 1 | 2; belt_speed: number; stack_size: number; lane_length: number;
    lane_items: string[]; frames: [number, [number, number][], [number, number][]][];
}
const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.DIFFERENT_ITEMS,
    "front-pickup-end-clips.json"), "utf8")) as {seed_tick: number; last_tick: number; clips: Clip[]};
let config: Config;
beforeAll(async () => {config = await loadConfigFromFile(path.join(GameFixturePaths.DIFFERENT_ITEMS, "config.json"));});

// Recorded in Factorio 2.1.24: a legendary stack inserter at the dead end of a full turbo belt kept fed, in line with the
// belt (front) or beside the end tile. The front pickup stands in as side-straight, the layout a config without one gets.
// Each hand takes the stacks at 0.75, then 0.875, 0.5 and 0.875 tile from the end, and the two end-most stacks stay; the
// lane follows the flip (near lane 1 unmirrored, 2 mirrored). Native hand starts and drops are inputs. A clip with two
// items runs with the filter of its item and with none.
const cases = fixture.clips.flatMap(clip => clip.lane_items[0] === clip.lane_items[1]
    ? [{clip, filters: [clip.item] as string[] | undefined}]
    : [{clip, filters: [clip.item] as string[] | undefined}, {clip, filters: undefined}]);
for (const {clip, filters} of cases) test(`the pickup at a belt end matches native clip: ${clip.name} (${clip.layout}${filters ? "" : ", no filter"})`, () => {
    const copy = withEveryLaneEnd(structuredClone(config), "dead_end");
    const input = copy.inserters.find(i => i.source.type === "belt")!;
    if (input.source.type !== "belt") throw Error("Expected a belt source");
    input.source.pickup_length = 1;
    input.source.pickup_layout = "side-straight";
    input.source.near_lane = clip.near_lane;
    if (filters) input.filters = filters; else delete input.filters;
    const belt = copy.belts.find(b => b.id === input.source.id)!;
    belt.type = "turbo-transport-belt";
    belt.lanes.forEach((lane, index) => {lane.ingredient = clip.lane_items[index];});
    const context = SimulationContext.fromConfig(copy);
    const state = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw Error("Expected a belt");
    const createPickup = () => bindHandPorts({inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
        tick_provider: context.tick_provider}).pickup;
    let pickup = createPickup();
    const lanes = source.pickupsOf(state.entity_id.id)!;
    let collecting = false;
    for (let index = 0; index < clip.frames.length; index++) {
        const tick = fixture.seed_tick + index;
        context.tick_provider.setCurrentTick(tick);
        const [actual, ...stock] = clip.frames[index], previous = clip.frames[index - 1]?.[0] ?? 0;
        if (actual < previous) {
            state.held_item = null;
            state.inventoryState.clear();
            collecting = false;
        }
        if (actual > previous && previous === 0) {
            collecting = true;
            pickup = createPickup();
        }
        if (collecting && (state.held_item?.quantity ?? 0) < clip.stack_size) pickup.pickup();
        expect(state.held_item?.quantity ?? 0, `held at ${tick}`).toBe(actual);
        if (actual > 0) expect(state.held_item?.item_name, `item at ${tick}`).toBe(clip.item);
        lanes.forEach((lane, laneIndex) => {
            expect(lane).toBeInstanceOf(BackpressurePickupLane);
            expect((lane as BackpressurePickupLane).snapshot(tick), `lane ${laneIndex + 1} at ${tick}`).toEqual(stock[laneIndex]);
        });
    }
});
