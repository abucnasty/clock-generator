import fs from "fs";
import path from "path";
import {beforeAll, expect, test} from "vitest";
import {BackedUpPickupLane, backedUpHandGrabTicks} from "./backed-up-pickup-lane";
import {BeltSpeed} from "../entities/belt";
import {Config} from "../config";
import {loadConfigFromFile} from "../config/loader";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {bindHandPorts} from "../simulation/components/hand-ports";
import {EntityState} from "./entity-state";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";

interface Clip {
    name: string; item: string; belt_speed: number; stack_size: number; lane_length: number;
    lane_items: string[]; frames: [number, [number, number][], [number, number][]][];
}
const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.DIFFERENT_ITEMS,
    "jammed-pickup-clips.json"), "utf8")) as {seed_tick: number; last_tick: number; clips: Clip[]};
let config: Config;
beforeAll(async () => {config = await loadConfigFromFile(path.join(GameFixturePaths.DIFFERENT_ITEMS, "config.json"));});

// Collection and stock are independently predicted. Native arm arrival and drop boundaries remain inputs.
for (const clip of fixture.clips) test(`production backed-up stock matches native clip: ${clip.name}`, () => {
    const copy = structuredClone(config);
    copy.overrides = {...copy.overrides, backed_up_belts: true};
    const input = copy.inserters.find(i => i.source.type === "belt")!;
    if (input.source.type !== "belt") throw Error("Expected a belt source");
    input.source.pickup_length = clip.lane_length as 0.5 | 1;
    input.source.pickup_layout = clip.lane_length === 1 ? "side-straight" : clip.name.includes("entrance") ? "side-entrance" : "side-exit";
    input.filters = [clip.item];
    const belt = copy.belts.find(b => b.id === input.source.id)!;
    const types = {"0.125": "turbo-transport-belt", "0.09375": "express-transport-belt",
        "0.0625": "fast-transport-belt", "0.03125": "transport-belt"} as const;
    belt.type = types[String(clip.belt_speed) as keyof typeof types];
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
            pickup = createPickup(); // Replacing a control must not refill its source.
        }
        if (collecting && (state.held_item?.quantity ?? 0) < clip.stack_size) pickup.pickup();
        expect(state.held_item?.quantity ?? 0, `held at ${tick}`).toBe(actual);
        lanes.forEach((lane, laneIndex) => {
            expect(lane).toBeInstanceOf(BackedUpPickupLane);
            expect((lane as BackedUpPickupLane).snapshot(tick), `lane ${laneIndex + 1} at ${tick}`).toEqual(stock[laneIndex]);
        });
    }
});

test("refill after a long pause is equivalent to advancing each tick and does not grow the stored train", () => {
    const skipped = new BackedUpPickupLane(BeltSpeed.TRANSPORT_BELT, 0.5, 4);
    const stepped = new BackedUpPickupLane(BeltSpeed.TRANSPORT_BELT, 0.5, 4);
    for (const lane of [skipped, stepped]) {
        expect([0, 1, 2, 3].map(tick => lane.take(tick, 4))).toEqual([4, 4, 4, 0]);
    }
    for (let tick = 4; tick <= 100; tick++) stepped.snapshot(tick);
    expect(skipped.stateKey(100)).toEqual(stepped.stateKey(100));
    expect(skipped.snapshot(1_000_000_000)).toEqual([[0, 4], [64, 4]]);
    expect(skipped.stateKey(1_000_000_000).length).toBeLessThan(80);
});

test("partial stacks remain until consumed and one lane cannot give two stacks in the same tick", () => {
    const lane = new BackedUpPickupLane(BeltSpeed.TRANSPORT_BELT, 0.5, 4);
    expect(lane.take(0, 2)).toBe(2);
    expect(lane.snapshot(0)).toEqual([[0, 4], [64, 2]]);
    expect(lane.take(0, 4)).toBe(0);
    expect(lane.take(1, 4)).toBe(2);
    expect(lane.take(2, 4)).toBe(4);
    expect(() => lane.snapshot(1)).toThrow("backwards in time");
});

// The first hands recorded from backed-up lanes at rest in Factorio 2.1.21, 16-item hands on four-item belt stacks
// (docs/belt-pickup/experiments.md, tick-pattern matrix): a stack a tick while the pickup exposes enough of them, then as
// fast as the belt brings them into reach.
const TIERS = [
    ["turbo", BeltSpeed.TURBO_TRANSPORT_BELT], ["express", BeltSpeed.EXPRESS_TRANSPORT_BELT],
    ["fast", BeltSpeed.FAST_TRANSPORT_BELT], ["normal", BeltSpeed.TRANSPORT_BELT],
] as const;
const one_lane = (length_tiles: number) => [{length_tiles, stack_size: 4}];
test.each(TIERS)("a hand fills from a straight belt at rest a stack a tick at %s", (_, speed) => {
    expect(backedUpHandGrabTicks(speed, one_lane(1), 16)).toEqual([0, 1, 2, 3]);
});
test.each([...TIERS.map(([name, speed]) => [name, speed, {turbo: [0, 1, 2, 3], express: [0, 1, 2, 3], fast: [0, 1, 2, 5], normal: [0, 1, 2, 9]}[name]] as const)])(
    "a hand fills from the half tile of an underground end at rest, the item on one lane, at %s", (_, speed, grabs) => {
        expect(backedUpHandGrabTicks(speed, one_lane(0.5), 16)).toEqual(grabs);
    });
test.each(TIERS)("the other lane with the same item fills the hand a stack a tick at %s", (_, speed) => {
    expect(backedUpHandGrabTicks(speed, [...one_lane(0.5), ...one_lane(0.5)], 16)).toEqual([0, 1, 2, 3]);
});
test("a hand of no stacks, or with no lane of its item, has no grabs", () => {
    expect(backedUpHandGrabTicks(BeltSpeed.TRANSPORT_BELT, one_lane(0.5), 0)).toEqual([]);
    expect(backedUpHandGrabTicks(BeltSpeed.TRANSPORT_BELT, [], 16)).toEqual([]);
});
