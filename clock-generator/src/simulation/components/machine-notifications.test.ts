import {describe, expect, it} from "vitest";
import {ConfigSchema} from "../../config/schema";
import {SimulationContext} from "../../crafting/sequence/simulation-context";
import {MachineState} from "../../state/machine-state";
import {MachineNotificationCause} from "./machine-notifications";

function source(speed = 1.25): MachineState {
    const context = SimulationContext.fromConfig(ConfigSchema.parse({
        target_output: {recipe: "copper-cable", items_per_second: 5, copies: 1},
        machines: [{id: 1, recipe: "copper-cable", productivity: 0, crafting_speed: speed}],
        inserters: [], belts: [],
    }));
    return context.machines[0].machine_state;
}

function listen(machine: MachineState): {inputs: MachineNotificationCause[]; outputs: MachineNotificationCause[]} {
    const inputs: MachineNotificationCause[] = [], outputs: MachineNotificationCause[] = [];
    machine.yield.notifications.subscribeInput(cause => inputs.push(cause));
    machine.yield.notifications.subscribeOutput(cause => outputs.push(cause));
    return {inputs, outputs};
}

describe("production machine notification sources", () => {
    it("notifies inputs when ingredients are consumed, not merely when that craft finishes", () => {
        const machine = source();
        const events = listen(machine);
        machine.inventoryState.addQuantity("copper-plate", 1);
        machine.crafting.tick();
        expect(machine.craftsStarted).toBe(1);
        expect(machine.craftCount).toBe(0);
        expect(events).toEqual({inputs: ["ingredients-consumed"], outputs: []});
        machine.craftingProgress.progress = 0.99;
        machine.crafting.tick();
        expect(machine.craftCount).toBe(1);
        expect(machine.output.getCurrentQuantity("copper-cable")).toBe(2);
        expect(events).toEqual({inputs: ["ingredients-consumed"], outputs: ["output-inserted"]});
    });

    it("preserves individual payouts and consumptions when several crafts run in one tick", () => {
        const machine = source(120);
        const events = listen(machine);
        machine.inventoryState.addQuantity("copper-plate", 4);
        machine.crafting.tick();
        expect(machine.craftCount).toBe(4);
        expect(events).toEqual({inputs: Array(4).fill("ingredients-consumed"), outputs: Array(4).fill("output-inserted")});
    });

    it("distinguishes cold stock hydration from a live insertion and output removal", () => {
        const machine = source();
        const events = listen(machine);
        machine.inventoryState.addQuantity("copper-cable", 8);
        expect(events).toEqual({inputs: [], outputs: []});
        machine.output.insert("copper-cable", 8);
        machine.output.take("copper-cable", 16);
        machine.output.insert("copper-cable", 0);
        machine.output.take("copper-cable", 0);
        expect(events).toEqual({inputs: ["output-removed"], outputs: ["output-inserted"]});
    });

    it("clones physical stock without copying subscriptions back into the original run", () => {
        const original = source();
        const original_events = listen(original);
        original.inventoryState.addQuantity("copper-cable", 8);
        const cloned = MachineState.clone(original);
        const cloned_events = listen(cloned);
        cloned.output.insert("copper-cable", 2);
        cloned.output.take("copper-cable", 1);
        expect(original_events).toEqual({inputs: [], outputs: []});
        expect(cloned_events).toEqual({inputs: ["output-removed"], outputs: ["output-inserted"]});
        expect(original.output.getCurrentQuantity("copper-cable")).toBe(8);
        expect(cloned.output.getCurrentQuantity("copper-cable")).toBe(9);
    });
});
