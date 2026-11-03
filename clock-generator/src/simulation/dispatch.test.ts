import {describe, expect, test} from "vitest";
import {ConfigSchema} from "../config/schema";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {SimulationTick} from "../crafting/runner/simulation-tick";
import {simulationStateKey} from "../crafting/runner/steady-state";
import {partialCells} from "./inserter-scheduling.fixture";
import {ACTIVATION_ORDER, inserterDispatchOf, keptListsOf} from "./dispatch";
import {ActiveScheduler} from "./active-scheduler";
import type {EnableControl} from "./controls/enable-control";

/** The update list's members by inserter number, front first */
function list(context: SimulationContext): number[] {
    return context.inserterScheduling()!.state().active_order
        .map(id => context.inserters.find(it => it.entity_id.id === id)!.entity_id.number);
}

/** A control open from `from` on, that answers from the clock alone */
function openFrom(context: SimulationContext, from: number, decider_build_order?: number): EnableControl {
    const at = (ticks: number) => context.tick_provider.getCurrentTick() + ticks >= from;
    return {isEnabled: () => at(0), isEnabledIn: at, is_game_clock: true, decider_build_order};
}

function cable(context: SimulationContext, machine: number): {insert(quantity: number): void} {
    const output = context.machines.find(it => it.machine_state.entity_id.number === machine)!.machine_state.output;
    return {insert: quantity => output.insert("copper-cable", quantity)};
}

describe("the new dispatch's update list", () => {
    test("the setting: off by default, its two open points named, the wake-up rule with it", () => {
        expect(inserterDispatchOf(undefined)).toBe("configured-order");
        expect(inserterDispatchOf("0")).toBe("configured-order");
        expect(inserterDispatchOf("1")).toEqual(ACTIVATION_ORDER);
        expect(inserterDispatchOf("same-tick,next-update"))
            .toEqual({kind: "activation-order", woken_in_walk: "same-tick", leaves: "next-update"});
        expect(() => inserterDispatchOf("ascending")).toThrow(/unknown value ascending/);
        expect(inserterDispatchOf("configured-order,kept-lists")).toBe("configured-order");
        expect([undefined, "0", "1", "same-tick", "configured-order", "configured-order,kept-lists"].map(keptListsOf))
            .toEqual([false, false, true, true, false, true]);
        expect(partialCells().inserter_dispatch).toBe("configured-order");
    });

    test("the list starts as a build leaves it, the last built first", () => {
        const context = partialCells();
        context.inserter_dispatch = ACTIVATION_ORDER;
        expect(list(context)).toEqual([3, 2, 1]);
    });

    test("entry: an inserter that becomes active goes to the front", () => {
        const context = partialCells();
        context.inserter_dispatch = ACTIVATION_ORDER;
        const tick = new SimulationTick(context);
        tick.executeForTick();
        // every source is empty: all three wait on it and leave
        expect(list(context)).toEqual([]);
        cable(context, 1).insert(2);
        expect(list(context)).toEqual([1]);
        cable(context, 3).insert(2);
        expect(list(context)).toEqual([3, 1]);
        cable(context, 2).insert(2);
        expect(list(context)).toEqual([2, 3, 1]);
    });

    test("exit: an inserter that waits leaves, the others keep their order, and it rejoins at the front", () => {
        const context = partialCells();
        context.inserter_dispatch = ACTIVATION_ORDER;
        cable(context, 1).insert(160);
        cable(context, 3).insert(160);
        const tick = new SimulationTick(context);
        tick.executeForTick();
        expect(list(context)).toEqual([3, 1]);
        for (let i = 0; i < 20; i++) tick.executeForTick();
        expect(list(context)).toEqual([3, 1]);
        cable(context, 2).insert(16);
        expect(list(context)).toEqual([2, 3, 1]);
        tick.executeForTick();
        expect(context.inserters.find(it => it.entity_id.number === 2)!.inserter_state.held_item?.quantity).toBe(16);
        expect(list(context)).toEqual([2, 3, 1]);
    });

    test("a control that disables an inserter takes it off the list; enabling it puts it at the front", () => {
        const context = partialCells();
        context.inserter_dispatch = ACTIVATION_ORDER;
        [1, 2, 3].forEach(machine => cable(context, machine).insert(160));
        context.useControls({inserter: state => state.entity_id.number === 1 ? openFrom(context, 10) : openFrom(context, 0)});
        const tick = new SimulationTick(context);
        tick.executeForTick();
        expect(list(context)).toEqual([3, 2]);
        while (context.tick_provider.getCurrentTick() < 8) tick.executeForTick();
        expect(list(context)).toEqual([3, 2]);
        // the window opens in tick 10: the inserter joins at the end of tick 9, ahead of the others
        tick.executeForTick();
        expect(list(context)).toEqual([1, 3, 2]);
        tick.executeForTick();
        expect(context.inserters.find(it => it.entity_id.number === 1)!.inserter_state.items_picked_up).toBe(16);
    });

    test("the list is part of the state a period repeats on, under the new dispatch only", () => {
        const off = partialCells();
        expect(simulationStateKey(off).split("\n")).toHaveLength(9);
        const on = partialCells();
        on.inserter_dispatch = ACTIVATION_ORDER;
        expect(simulationStateKey(on).split("\n")).toHaveLength(10);
    });
});

/** One machine whose output holds one hand, and two inserters that take from it into chests of their own */
function sharedSource(): SimulationContext {
    return SimulationContext.fromConfig(ConfigSchema.parse({
        target_output: {recipe: "copper-cable", items_per_second: 5, copies: 1},
        machines: [{id: 1, recipe: "copper-cable", productivity: 0, crafting_speed: 1.25, prototype: "assembling-machine-3"}],
        inserters: [1, 2].map(id => ({id, source: {type: "machine", id: 1}, sink: {type: "chest", id},
            prototype: "stack-inserter", quality: "legendary", stack_size: 16, filters: ["copper-cable"]})),
        belts: [],
        chests: [1, 2].map(id => ({id, type: "buffer-chest", storage_size: 4800, item_filter: "copper-cable", prototype: "steel-chest"})),
    }));
}

describe("two windows that open together on one hand's worth", () => {
    /**
     * Both windows open in tick 10; inserter 1's decider was built after inserter 2's. The game updates the inserter
     * whose decider was built last first (recorded in Factorio 2.1.21, `decider_build_order`): it is enabled last, so
     * it joins the list last, at the front. The configured order serves the higher config id first instead.
     */
    function takes(dispatch: "configured-order" | typeof ACTIVATION_ORDER): number[] {
        const context = sharedSource();
        context.inserter_dispatch = dispatch;
        cable(context, 1).insert(16);
        context.useControls({inserter: state => openFrom(context, 10, state.entity_id.number === 1 ? 1 : 0)});
        const tick = new SimulationTick(context);
        while (context.tick_provider.getCurrentTick() < 20) tick.executeForTick();
        return context.inserters.map(it => it.inserter_state).sort((a, b) => a.entity_id.number - b.entity_id.number)
            .map(it => it.items_picked_up);
    }

    test("the configured order serves inserter 2 first", () => {
        expect(takes("configured-order")).toEqual([0, 16]);
    });

    test("the update list serves the inserter enabled last first: inserter 1", () => {
        expect(takes(ACTIVATION_ORDER)).toEqual([16, 0]);
    });
});

describe("the two points the observations leave open", () => {
    function walk(woken_in_walk: "next-tick" | "same-tick"): string[] {
        const scheduler = new ActiveScheduler({active_order: ["a", "b"], remaining_updates: null, pending_next_phase: []},
            () => {}, woken_in_walk);
        const updated: string[] = [];
        scheduler.beginUpdates();
        for (let next = scheduler.nextUpdate(); next !== null; next = scheduler.nextUpdate()) {
            updated.push(next);
            if (next === "a") scheduler.activate("c", "woken by a");
        }
        scheduler.endUpdates();
        expect(scheduler.state().active_order).toEqual(["c", "a", "b"]);
        return updated;
    }

    test("woken in the walk: next tick by default, or after the members still to come", () => {
        expect(walk("next-tick")).toEqual(["a", "b"]);
        expect(walk("same-tick")).toEqual(["a", "b", "c"]);
    });

    test("an inserter updated in the walk and woken again later in it waits for the next tick either way", () => {
        const scheduler = new ActiveScheduler({active_order: ["a", "b"], remaining_updates: null, pending_next_phase: []},
            () => {}, "same-tick");
        scheduler.beginUpdates();
        expect(scheduler.nextUpdate()).toBe("a");
        scheduler.deactivate("a", "waits");
        scheduler.activate("a", "woken");
        expect(scheduler.nextUpdate()).toBe("b");
        expect(scheduler.nextUpdate()).toBeNull();
        scheduler.endUpdates();
    });

    test("leaving: after the update that finds it waiting, or one update later", () => {
        for (const leaves of ["after-update", "next-update"] as const) {
            const context = partialCells();
            context.inserter_dispatch = {...ACTIVATION_ORDER, leaves};
            const tick = new SimulationTick(context);
            tick.executeForTick();
            expect(list(context)).toEqual(leaves === "after-update" ? [] : [3, 2, 1]);
            tick.executeForTick();
            expect(list(context)).toEqual([]);
        }
    });
});
