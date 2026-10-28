import {beforeAll, expect, test} from "vitest";
import {Config} from "../../config";
import {loadConfigFromFile} from "../../config/loader";
import {SimulationContext} from "./simulation-context";
import {SimulationTick} from "../runner/simulation-tick";
import {simulationStateKey} from "../runner/steady-state";
import {EntityState, InserterStatus} from "../../state";
import {BeltHandDrop} from "../../simulation/components/belt-hand-drop";
import {HandScratch} from "../../simulation/components/hand";
import {bindHandPorts} from "../../simulation/components/hand-ports";
import {InserterPhase} from "../../simulation/status-codes";
import {GameFixturePaths} from "../../../tests/game/helpers/fixture-paths";

let config: Config;
beforeAll(async () => {config = await loadConfigFromFile(GameFixturePaths.SAME_ITEM_CONFIG);});

function setup(sameItem = true) {
    const copy = structuredClone(config);
    if (!sameItem) copy.belts[0].lanes[1]!.ingredient = "";
    const context = SimulationContext.fromConfig(copy);
    const state = context.inserters.find(i => i.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw Error("Expected a belt");
    const sink = context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id);
    const createPickup = () => bindHandPorts({inserterState: state, sourceState: source,
        sinkState: sink, tick_provider: context.tick_provider}).pickup;
    return {context, state, source, sink, createPickup};
}

test("a bounded observer changes neither physical state nor repeat detection during an operating run", () => {
    const plain = setup(), observed = setup();
    expect(plain.state.trace).toBeUndefined();
    const trace = observed.context.traceInserter(2, {max_events: 100});
    const ticks = [new SimulationTick(plain.context), new SimulationTick(observed.context)];
    for (let i = 0; i < 500; i++) {
        ticks.forEach(tick => tick.executeForTick());
        expect(simulationStateKey(observed.context)).toEqual(simulationStateKey(plain.context));
        expect(observed.state.items_picked_up).toBe(plain.state.items_picked_up);
        expect(observed.state.items_dropped).toBe(plain.state.items_dropped);
    }
    expect(trace.events.some(event => event.type === "mode" && event.to === InserterStatus.PICKUP)).toBe(true);
    expect(trace.events.some(event => event.type === "drop")).toBe(true);
    expect(trace.events).toHaveLength(100);
    expect(trace.truncated).toBe(true);
});

test("records the actual empty pickup-window waits instead of inventing a fixed underground surcharge", () => {
    const {context, state, createPickup} = setup(false);
    const pickup = createPickup(), trace = context.traceInserter(2);
    for (let tick = 0; tick <= 5; tick++) {
        context.tick_provider.setCurrentTick(tick);
        pickup.pickup();
    }
    expect(state.held_item?.quantity).toBe(16);
    expect(trace.events.filter(event => event.type === "pickup").map(event => event.tick)).toEqual([0, 1, 3, 5]);
    expect(trace.events.filter(event => event.type === "wait")).toEqual([
        {tick: 2, type: "wait", phase: "pickup", reason: "no_reachable_stack", item: "iron-plate"},
        {tick: 4, type: "wait", phase: "pickup", reason: "no_reachable_stack", item: "iron-plate"},
    ]);
});

test("records physical fallback and stays attached across pickup-control replacement", () => {
    const {context, createPickup} = setup();
    let pickup = createPickup();
    const trace = context.traceInserter(2);
    for (let tick = 0; tick < 4; tick++) {
        if (tick === 2) pickup = createPickup();
        context.tick_provider.setCurrentTick(tick);
        pickup.pickup();
    }
    const lanes = trace.events.filter(event => event.type === "pickup_lane");
    expect(lanes.map(event => [event.lane, event.fallback])).toEqual([[1, false], [1, false], [2, true], [1, false]]);
    expect(() => context.traceInserter(999)).toThrow("unknown inserter");
});

test("distinguishes withheld supply, machine refusal and the existing first-grab decision tick", () => {
    const {context, state, source, sink, createPickup} = setup();
    if (!EntityState.isMachine(sink)) throw Error("Expected machine");
    const trace = context.traceInserter(2);
    let pickup = createPickup();
    source.supply.withheld.add("iron-plate");
    pickup.pickup();
    source.supply.withheld.clear();
    sink.inventoryState.setQuantity("iron-plate", 100);
    context.tick_provider.setCurrentTick(1);
    pickup.pickup();
    sink.inventoryState.clear();
    state.waits_for_sink = true;
    pickup = createPickup();
    // the pickup phase entered from idle after a wait: its enter step reads the flag, then the Hand clears it
    pickup.enter(InserterPhase.IDLE);
    state.waits_for_sink = false;
    context.tick_provider.setCurrentTick(2);
    pickup.pickup();
    expect(trace.events.filter(event => event.type === "wait").map(event => event.reason))
        .toEqual(["supply_withheld", "destination_refused", "pickup_decision"]);
    expect(state.held_item).toBeNull();
});

test("output diagnostics distinguish a refused outlet from a wait for output space", () => {
    const {context, state, source} = setup();
    state.held_item = {item_name: "iron-plate", quantity: 16};
    state.inventoryState.setQuantity("iron-plate", 16);
    const drop = new BeltHandDrop(state, new HandScratch(), source, context.tick_provider);
    const trace = context.traceInserter(2);
    source.supply.refused.add("iron-plate");
    drop.drop();
    source.supply.refused.clear();
    for (let tick = 1; tick <= 4; tick++) {
        context.tick_provider.setCurrentTick(tick);
        drop.drop();
    }
    expect(trace.events.filter(event => event.type === "wait").map(event => [event.tick, event.reason]))
        .toEqual([[0, "supply_refused"], [4, "output_space"]]);
    expect(trace.events.filter(event => event.type === "drop").map(event => event.quantity)).toEqual([4, 4, 4]);
    expect(source.stateKey(4)).toBeDefined();
});

test("replacing a drop control preserves output stock through a partial hand and the next hand", () => {
    const {context, state, source} = setup();
    const trace = context.traceInserter(2);
    for (let tick = 0; tick <= 12; tick++) {
        if (tick === 0 || tick === 5) {
            state.held_item = {item_name: "iron-plate", quantity: 16};
            state.inventoryState.setQuantity("iron-plate", 16);
        }
        context.tick_provider.setCurrentTick(tick);
        const replacement = new BeltHandDrop(state, new HandScratch(), source, context.tick_provider);
        replacement.enter();
        if (state.held_item) replacement.drop();
    }
    expect(trace.events.filter(event => event.type === "drop").map(event => event.tick))
        .toEqual([0, 1, 2, 4, 6, 8, 10, 12]);
    expect(state.items_dropped).toBe(32);
});
