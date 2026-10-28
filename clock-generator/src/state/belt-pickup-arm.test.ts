import fs from "fs";
import path from "path";
import {beforeAll, expect, test} from "vitest";
import {BeltPickupArm} from "./belt-pickup-arm";
import {BeltPickupLane} from "./belt-pickup-lane";
import {BeltSpeed} from "../entities/belt";
import {EntityState} from "./entity-state";
import {InserterState} from "./inserter-state";
import {Config} from "../config";
import {loadConfigFromFile} from "../config/loader";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {InserterPickupMode} from "../control-logic/inserter/modes/pickup/pickup-mode";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";

// Native IDs and hand coordinates remain in the fixture as evidence; the model predicts collection and stock,
// not rendered hand coordinates. Only the first arm-arrival tick and the initial full stock are supplied.
type Frame = [tick: number, held: number, handX: number, handY: number,
    near: [id: number, position: number, count: number][], far: [id: number, position: number, count: number][]];
const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.DIFFERENT_ITEMS, "arm-travel-clips.json"), "utf8")) as {
    clips: {release_delay: number; first_grab: number; frames: Frame[]}[];
};
let config: Config;
beforeAll(async () => {config = await loadConfigFromFile(path.join(GameFixturePaths.DIFFERENT_ITEMS, "config.json"));});

for (const clip of fixture.clips) test(`production pickup and stock match the normal entrance phase ${clip.release_delay}`, () => {
    const copy = structuredClone(config);
    const input = copy.inserters[1];
    if (input.source.type !== "belt") throw Error("Expected belt");
    input.source.pickup_layout = "side-entrance";
    input.filters = ["accumulator"];
    const belt = copy.belts.find(belt => belt.id === input.source.id)!;
    belt.type = "transport-belt";
    belt.lanes.forEach(lane => {lane.ingredient = "accumulator";});
    const context = SimulationContext.fromConfig(copy);
    const state = context.inserters.find(inserter => inserter.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw Error("Expected belt");
    const seed = clip.frames[0];
    const lanes = seed.slice(4).map(stock => {
        const phase = (((stock as Frame[4])[0][1] / 8 + seed[0]) % 8 + 8) % 8;
        return new BeltPickupLane(BeltSpeed.TRANSPORT_BELT, 0.5, 4, phase);
    });
    source.seedPickups(state.entity_id.id, lanes);
    const createMode = () => InserterPickupMode.create({inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id), tick_provider: context.tick_provider});
    let mode = createMode();
    const trace = context.traceInserter(2);
    for (const [tick, actual, , , near, far] of clip.frames) {
        context.tick_provider.setCurrentTick(tick);
        // Replace the control mid-hand: physical reach and lane holes must survive.
        if (tick === clip.first_grab + 2) mode = createMode();
        if (tick >= clip.first_grab && (state.held_item?.quantity ?? 0) < 16) mode.executeForTick();
        expect(state.held_item?.quantity ?? 0, `held at ${tick}`).toBe(actual);
        for (const [index, stock] of [near, far].entries()) {
            expect(lanes[index].snapshot(tick), `lane ${index + 1} at ${tick}`).toEqual(stock.map(([, position, count]) => [position, count]));
        }
    }
    const waits = trace.events.filter(event => event.type === "wait" && event.reason === "arm_travel");
    expect(waits.map(event => event.tick)).toEqual(clip.release_delay < 4 ? [clip.first_grab + 2] : []);
});

test("one tick advances extension once, even across control pauses; clones retain independent physical state", () => {
    const arm = new BeltPickupArm(64);
    expect(arm.tryCollect(0, 196, true)).toBe(true);
    expect(arm.tryCollect(100, 334, false)).toBe(false);
    expect(arm.tryCollect(100, 334, false)).toBe(false);
    const copy = arm.clone();
    expect(copy.stateKey(100)).toBe(arm.stateKey(100));
    expect(copy.tryCollect(101, 334, false)).toBe(true);
    expect(copy.stateKey(101)).not.toBe(arm.stateKey(101));
    expect(arm.tryCollect(101, 334, false)).toBe(true);
    const shifted = new BeltPickupArm(64);
    shifted.tryCollect(999, 334, true);
    expect(shifted.stateKey(999)).toBe(arm.stateKey(101));
});

test("repeat detection retains partial-hand reach but ignores the discarded reach of empty or full hands", () => {
    const context = SimulationContext.fromConfig(structuredClone(config));
    const state = context.inserters.find(inserter => inserter.entity_id.number === 2)!.inserter_state;
    state.pickup_arm = new BeltPickupArm(64);
    state.pickup_arm.tryCollect(10, 196, true);
    const copy = InserterState.clone(state);
    copy.pickup_arm!.tryCollect(10, 316, true);
    expect(InserterState.stateKey(state, 10)).toBe(InserterState.stateKey(copy, 10));
    state.held_item = copy.held_item = {item_name: "accumulator", quantity: 4};
    expect(InserterState.stateKey(state, 10)).not.toBe(InserterState.stateKey(copy, 10));
    state.held_item = copy.held_item = {item_name: "accumulator", quantity: 16};
    expect(InserterState.stateKey(state, 10)).toBe(InserterState.stateKey(copy, 10));
});
