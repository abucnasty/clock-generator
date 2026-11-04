import {describe, expect, test} from "vitest";
import {ConfigSchema} from "../config/schema";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {SimulationTick} from "../crafting/runner/simulation-tick";
import {ACTIVATION_ORDER, InserterDispatch} from "./dispatch";
import {EnableControl} from "./controls/enable-control";

/**
 * The game's control latency, as recorded in Factorio 2.1.24 (tests/game/mechanics/control-latency/): a decider switches
 * inserters, and the first items reach a hand in the same tick after the enable whatever the inserter was doing when it
 * came: idle at a full chest, asleep at a machine that had room again by then, two inserters on one decider. An
 * inserter asleep at a machine that another inserter's take or the machine's craft gives room takes its first items in
 * the tick after that take or craft, never in its tick. A disable lets a moving hand finish its swing and drop.
 *
 * The simulator's frame: a clock of the game enables the inserter in tick `w` and its hand takes in `w` (the tick the
 * game shows the inserter's status change is the one before). These checks hold the simulator's hand to the same ticks
 * the game showed, relative to the window.
 */

/** chest (plates) -> inserter 1 -> assembling machine 3 (iron gear wheel) -> inserter 2 -> chest */
function gearCell(dispatch: InserterDispatch): SimulationContext {
    const context = SimulationContext.fromConfig(ConfigSchema.parse({
        target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1},
        machines: [{id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1.25, prototype: "assembling-machine-3"}],
        inserters: [
            {id: 1, source: {type: "chest", id: 1}, sink: {type: "machine", id: 1}, prototype: "stack-inserter", quality: "legendary",
                stack_size: 16, filters: ["iron-plate"]},
            {id: 2, source: {type: "machine", id: 1}, sink: {type: "chest", id: 2}, prototype: "stack-inserter", quality: "legendary",
                stack_size: 16, filters: ["iron-gear-wheel"]},
        ],
        belts: [],
        chests: [
            {id: 1, type: "infinity-chest", item_filter: [{item_name: "iron-plate", request_count: 4800}]},
            {id: 2, type: "buffer-chest", storage_size: 4800, item_filter: "iron-gear-wheel", prototype: "steel-chest"},
        ],
    }));
    context.inserter_dispatch = dispatch;
    return context;
}

/** A clock of the game, enabled in the ticks `open` says */
function clock(context: SimulationContext, open: (tick: number) => boolean): EnableControl {
    const at = (ticks: number) => open(context.tick_provider.getCurrentTick() + ticks);
    return {isEnabled: () => at(0), isEnabledIn: at, is_game_clock: true};
}

const always = (context: SimulationContext) => clock(context, () => true);

interface Trace {picked: number[][]}

/** Runs to `ticks`: the items each inserter has picked up after each tick */
function run(context: SimulationContext, ticks: number): Trace {
    const byNumber = (n: number) => context.inserters.find(it => it.entity_id.number === n)!.inserter_state;
    const trace: Trace = {picked: [[], []]};
    const tick = new SimulationTick(context);
    while (context.tick_provider.getCurrentTick() < ticks) {
        tick.executeForTick();
        trace.picked[0].push(byNumber(1).items_picked_up);
        trace.picked[1].push(byNumber(2).items_picked_up);
    }
    return trace;
}

/** The first tick (1-based, the tick the row was taken after) at which the series changes from its value before */
function firstChange(series: number[]): number {
    const index = series.findIndex(value => value !== 0);
    return index < 0 ? -1 : index + 1;
}

const dispatch = ACTIVATION_ORDER;

describe("control latency", () => {
    test("idle with items: the first items in the tick the window opens", () => {
        const context = gearCell(dispatch);
        context.useControls({inserter: state => state.entity_id.number === 1 ? clock(context, t => t >= 10) : always(context)});
        expect(firstChange(run(context, 30).picked[0])).toBe(10);
    });

    test("asleep at a machine that has room again when the enable comes: the same tick as idle", () => {
        const context = gearCell(dispatch);
        context.machines[0].machine_state.output.insert("iron-gear-wheel", 12);
        // the feeder waits at the block, is disabled from 20, the taker empties the output from 25, the feeder is enabled at 40
        context.useControls({inserter: state => state.entity_id.number === 1
            ? clock(context, t => t < 20 || t >= 40) : clock(context, t => t >= 25)});
        const trace = run(context, 60);
        expect(trace.picked[0][38]).toBe(0);
        expect(firstChange(trace.picked[1])).toBe(25);
        expect(firstChange(trace.picked[0])).toBe(40);
    });

    test("woken by another inserter's take: the first items in the tick after the take", () => {
        const context = gearCell(dispatch);
        context.machines[0].machine_state.output.insert("iron-gear-wheel", 12);
        context.useControls({inserter: state => state.entity_id.number === 1 ? always(context) : clock(context, t => t >= 10)});
        const trace = run(context, 30);
        const take = firstChange(trace.picked[1]);
        expect(take).toBe(10);
        expect(firstChange(trace.picked[0])).toBe(take + 1);
    });
});

/**
 * A craft finishes at the block (2 gears, 3 crafts' plates: the second craft puts the output at its block of 4, the third
 * past it), the feeder is enabled while it waits there, and the taker takes in the tick after the third craft finished
 */
function craftThenTake(dispatch: InserterDispatch): {finished: number; take: number; feeder: number} {
    // the taker's clock opens in the tick after the third craft: the tick a first run, the taker off throughout, finds that
    // craft in (the taker is off until then in both runs, so the crafts come in the same ticks)
    const runWith = (taker_opens: number) => {
        const context = gearCell(dispatch);
        const machine = context.machines[0].machine_state;
        machine.output.insert("iron-gear-wheel", 2);
        machine.inventoryState.addQuantity("iron-plate", 6);
        const crafts: number[] = [];
        context.useControls({inserter: state => state.entity_id.number === 1
            ? clock(context, t => t >= 55) : clock(context, t => t >= taker_opens)});
        const trace: Trace = {picked: [[], []]};
        const tick = new SimulationTick(context);
        while (context.tick_provider.getCurrentTick() < 120) {
            tick.executeForTick();
            crafts.push(machine.craftCount);
            trace.picked[0].push(context.inserters.find(it => it.entity_id.number === 1)!.inserter_state.items_picked_up);
            trace.picked[1].push(context.inserters.find(it => it.entity_id.number === 2)!.inserter_state.items_picked_up);
        }
        return {finished: firstChange(crafts.map(count => Math.max(0, count - 2))), take: firstChange(trace.picked[1]), feeder: firstChange(trace.picked[0])};
    };
    return runWith(runWith(Number.POSITIVE_INFINITY).finished + 1);
}

test("the update list: a craft that finished at the block in the tick before the take leaves the feeder's first items a tick after the take, as the game", () => {
    const {finished, take, feeder} = craftThenTake(ACTIVATION_ORDER);
    expect(take).toBe(finished + 1);
    expect(feeder).toBe(take + 1);
});

test("an inserter woken in the walk updated in that tick (`woken_in_walk` same-tick) takes in the tick of the take, which the game does not show", () => {
    const context = gearCell({...ACTIVATION_ORDER, woken_in_walk: "same-tick"});
    context.machines[0].machine_state.output.insert("iron-gear-wheel", 12);
    context.useControls({inserter: state => state.entity_id.number === 1 ? always(context) : clock(context, t => t >= 10)});
    const trace = run(context, 30);
    expect(firstChange(trace.picked[0])).toBe(firstChange(trace.picked[1]));
});
