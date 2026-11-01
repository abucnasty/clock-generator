import {expect, test} from "vitest";
import {InserterScheduling} from "./inserter-scheduling";
import {partialCells} from "./inserter-scheduling.fixture";
import {EnableControl} from "./controls/enable-control";

/** Run the integrated component without installing the rejected default World-dispatch candidate. */
function driver() {
    const context = partialCells();
    const schedule = new InserterScheduling(context, context.inserters);
    const update = () => {
        schedule.beginUpdates();
        for (let hand = schedule.nextUpdate(); hand !== null; hand = schedule.nextUpdate()) {
            hand.executeForTick();
            schedule.completeUpdate(hand);
        }
        schedule.finishControls();
        schedule.endUpdates();
    };
    return {context, schedule, update};
}

test("a machine source Alarm activates a disabled hand without authorizing pickup", () => {
    const {context, schedule, update} = driver();
    context.useControls({inserter: () => EnableControl.never});
    update();
    const events: string[] = [];
    schedule.observe(event => events.push(event.event));
    context.machines[0].machine_state.output.insert("copper-cable", 2);
    expect(events).toEqual(["Alarm", "Activation"]);
    update();
    expect(events).toEqual(["Alarm", "Activation", "Update", "Deactivation"]);
    expect(context.inserters[0].inserter_state.held_item).toBeNull();
    expect(context.machines[0].machine_state.output.getCurrentQuantity("copper-cable")).toBe(2);
});

test("a simulator control swap preserves partial carry and its live subscriptions", () => {
    const {context, schedule, update} = driver();
    const source = context.machines[0].machine_state;
    source.inventoryState.addQuantity("copper-cable", 8);
    update();
    expect(schedule.state().active_order).toEqual([]);
    const physical = context.inserters[0].inserter_state;
    const before = [physical.held_item, physical.items_picked_up, physical.items_dropped];
    context.useControls({inserter: () => EnableControl.always});
    expect([physical.held_item, physical.items_picked_up, physical.items_dropped]).toEqual(before);
    const order = schedule.state().active_order;
    context.useControls({inserter: () => EnableControl.always});
    expect(schedule.state().active_order).toEqual(order);
    source.output.insert("copper-cable", 2);
    update();
    expect(physical.held_item?.quantity).toBe(10);
    expect(physical.items_picked_up).toBe(10);
    expect(physical.items_dropped).toBe(0);
});

test("hydration retains open-phase eligibility and independently binds the cloned run", () => {
    const {context, schedule, update} = driver();
    update();
    schedule.beginUpdates();
    context.machines[0].machine_state.output.insert("copper-cable", 2);
    expect(schedule.nextUpdate()).toBeNull();
    const state = schedule.state();
    expect(state).toMatchObject({remaining_updates: [], pending_next_phase: ["inserter:1"]});
    const copied_context = partialCells();
    copied_context.machines[0].machine_state.inventoryState.addQuantity("copper-cable", 2);
    const copied = new InserterScheduling(copied_context, copied_context.inserters, () => {}, state);
    expect(copied.key()).toBe(schedule.key());
    for (const current of [schedule, copied]) {
        current.endUpdates();
        current.beginUpdates();
        const hand = current.nextUpdate()!;
        expect(hand.entity_id.id).toBe("inserter:1");
        hand.executeForTick();
        current.completeUpdate(hand);
        expect(hand.inserter_state.held_item?.quantity).toBe(2);
        expect(current.nextUpdate()).toBeNull();
        current.endUpdates();
    }
    expect(copied.key()).toBe(schedule.key());
    copied_context.machines[0].machine_state.output.insert("copper-cable", 2);
    expect(copied.key()).not.toBe(schedule.key());
    expect(() => new InserterScheduling(partialCells(), [], () => {}, state)).toThrow("unknown inserter");
});

test.each([false, true])("known control build order sets simultaneous attachment order (reversed=%s)", reversed => {
    const context = partialCells();
    context.machines.forEach(machine => machine.machine_state.inventoryState.addQuantity("copper-cable", 2));
    context.useControls({inserter: state => ({
        is_game_clock: true,
        decider_build_order: reversed ? 3 - state.entity_id.number : state.entity_id.number - 1,
        isEnabled: () => context.tick_provider.getCurrentTick() >= 3,
        isEnabledIn: offset => context.tick_provider.getCurrentTick() + offset >= 3,
    })});
    const updates: string[] = [];
    const schedule = new InserterScheduling(context, context.inserters, event => {
        if (event.event === "Update" && context.tick_provider.getCurrentTick() === 3) updates.push(event.entity);
    });
    for (let tick = 1; tick <= 3; tick++) {
        context.tick_provider.setCurrentTick(tick);
        schedule.beginUpdates();
        for (let hand = schedule.nextUpdate(); hand !== null; hand = schedule.nextUpdate()) {
            hand.executeForTick();
            schedule.completeUpdate(hand);
        }
        schedule.finishControls();
        schedule.endUpdates();
    }
    expect(updates).toEqual(reversed ? ["inserter:1", "inserter:2", "inserter:3"] : ["inserter:3", "inserter:2", "inserter:1"]);
    expect(context.inserters.map(hand => hand.inserter_state.held_item?.quantity)).toEqual([2, 2, 2]);
});
