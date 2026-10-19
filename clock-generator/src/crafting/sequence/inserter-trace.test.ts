import {beforeAll, expect, test} from "vitest";
import {Config} from "../../config";
import {loadConfigFromFile} from "../../config/loader";
import {SimulationContext} from "./simulation-context";
import {SimulationTick} from "../runner/simulation-tick";
import {simulationStateKey} from "../runner/steady-state";
import {BeltState, EntityState, InserterState, InserterStatus} from "../../state";
import {InserterPickupMode} from "../../control-logic/inserter/modes/pickup/pickup-mode";
import {BeltDropLogic} from "../../control-logic/inserter/modes/drop/belt-drop-logic";
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
    const createMode = () => InserterPickupMode.create({inserterState: state, sourceState: source,
        sinkState: sink, tick_provider: context.tick_provider});
    return {context, state, source, sink, createMode};
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
    const {context, state, createMode} = setup(false);
    const mode = createMode(), trace = context.traceInserter(2);
    for (let tick = 0; tick <= 5; tick++) {
        context.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
    }
    expect(state.held_item?.quantity).toBe(16);
    expect(trace.events.filter(event => event.type === "pickup").map(event => event.tick)).toEqual([0, 1, 3, 5]);
    expect(trace.events.filter(event => event.type === "wait")).toEqual([
        {tick: 2, type: "wait", phase: "pickup", reason: "no_reachable_stack", item: "iron-plate"},
        {tick: 4, type: "wait", phase: "pickup", reason: "no_reachable_stack", item: "iron-plate"},
    ]);
});

test("records physical fallback and stays attached across pickup-control replacement, not state cloning", () => {
    const {context, state, createMode} = setup();
    let mode = createMode();
    const trace = context.traceInserter(2);
    for (let tick = 0; tick < 4; tick++) {
        if (tick === 2) mode = createMode();
        context.tick_provider.setCurrentTick(tick);
        mode.executeForTick();
    }
    const lanes = trace.events.filter(event => event.type === "pickup_lane");
    expect(lanes.map(event => [event.lane, event.fallback])).toEqual([[1, false], [1, false], [2, true], [1, false]]);
    expect(InserterState.clone(state).trace).toBeUndefined();
    expect(() => context.traceInserter(999)).toThrow("unknown inserter");
});

test("distinguishes withheld supply, machine refusal and the existing first-grab decision tick", () => {
    const {context, state, source, sink, createMode} = setup();
    if (!EntityState.isMachine(sink)) throw Error("Expected machine");
    const trace = context.traceInserter(2);
    let mode = createMode();
    source.supply.withheld.add("iron-plate");
    mode.executeForTick();
    source.supply.withheld.clear();
    sink.inventoryState.setQuantity("iron-plate", 100);
    context.tick_provider.setCurrentTick(1);
    mode.executeForTick();
    sink.inventoryState.clear();
    state.waits_for_sink = true;
    mode = createMode();
    mode.onEnter({status: InserterStatus.IDLE, executeForTick() {}, onEnter() {}, onExit() {}});
    context.tick_provider.setCurrentTick(2);
    mode.executeForTick();
    expect(trace.events.filter(event => event.type === "wait").map(event => event.reason))
        .toEqual(["supply_withheld", "destination_refused", "pickup_decision"]);
    expect(state.held_item).toBeNull();
});

test("output diagnostics distinguish a refused outlet from a wait for drop cadence", () => {
    const {context, state, source} = setup();
    state.held_item = {item_name: "iron-plate", quantity: 16};
    state.inventoryState.setQuantity("iron-plate", 16);
    const drop = new BeltDropLogic(state, source, context.tick_provider);
    const trace = context.traceInserter(2);
    source.supply.refused.add("iron-plate");
    drop.executeForTick();
    source.supply.refused.clear();
    for (let tick = 1; tick <= 4; tick++) {
        context.tick_provider.setCurrentTick(tick);
        drop.executeForTick();
    }
    expect(trace.events.filter(event => event.type === "wait").map(event => [event.tick, event.reason]))
        .toEqual([[0, "supply_refused"], [4, "drop_cadence"]]);
    expect(trace.events.filter(event => event.type === "drop").map(event => event.quantity)).toEqual([4, 4, 4]);
    expect(BeltState.stateKey(source, 4)).toBeDefined();
});
