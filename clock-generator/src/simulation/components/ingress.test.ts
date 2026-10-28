import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { FactorioDataService } from "../../data";
import { Machine, MachineSpec, RecipeMetadata } from "../../entities";
import { directMachineInsertionLimit } from "../../entities/drill/mining-drill-ext";
import { MachineState } from "../../state/machine-state";
import { Ingress } from "./ingress";
import { DropBy } from "./ports";

const machineState = (recipe: string, spec: Partial<MachineSpec> = {}) => MachineState.forMachine(Machine.createMachine(1, {
    crafting_speed: 1,
    productivity: 0,
    recipe: RecipeMetadata.fromRecipeName(recipe),
    ...spec,
}));

/** A biochamber on pentapod eggs: nutrients are its fuel and an ingredient, the egg an ingredient it also makes */
const eggs = () => machineState("pentapod-egg", { prototype: "biochamber", crafting_speed: 64.5, productivity: 150, energy_consumption_bonus: 1020 });

/** A biochamber on rocket fuel: nutrients are only its fuel */
const rocketFuel = () => machineState("rocket-fuel-from-jelly", { prototype: "biochamber", crafting_speed: 2 });

/** A fresh Ingress over the same inventories: no memo, so it works every answer out again */
const fresh = (state: MachineState) => new Ingress(state.machine, state.inventoryState, state.fuelInventory, state.selfIngredients);

describe("a machine's Ingress", () => {
    it("takes the ingredients of its recipe and its fuel, and binds a slot for each", () => {
        const ingress = rocketFuel().ingress;
        for (const item of ["jelly", "bioflux", "nutrients"]) {
            expect(ingress.takes(item)).toBe(true);
            expect(ingress.slotOf(item)).toBeGreaterThanOrEqual(0);
        }
        expect(ingress.takes("coal")).toBe(false);
        expect(ingress.slotOf("coal")).toBe(-1);
        expect(ingress.blockedAt(-1)).toBe(true);
        expect(ingress.blocked("coal")).toBe(true);
    });

    it("blocks an ingredient at its insertion limit or while the output is at its block, and fuel only at its own limit", () => {
        const state = rocketFuel();
        const ingress = state.ingress;
        const jelly = state.machine.inputs.getOrThrow("jelly").automated_insertion_limit.quantity;
        expect(ingress.blocked("jelly")).toBe(false);
        state.inventoryState.setQuantity("jelly", jelly);
        expect(ingress.blocked("jelly")).toBe(true);
        state.inventoryState.setQuantity("jelly", 0);
        state.inventoryState.setQuantity("rocket-fuel", state.machine.output.outputBlock.ingredients_blocked_at);
        expect(ingress.outputBlocked()).toBe(true);
        expect(ingress.blocked("jelly")).toBe(true);
        expect(ingress.blocked("nutrients")).toBe(false);
        state.fuelInventory.setQuantity("nutrients", state.machine.fuel_slot!.automated_insertion_limit);
        expect(ingress.blocked("nutrients")).toBe(true);
        expect(ingress.takesNothing()).toBe(true);
        state.fuelInventory.setQuantity("nutrients", 0);
        expect(ingress.takesNothing()).toBe(false);
    });

    it("blocks a machine that places its results itself at a stack of any one result", () => {
        const state = machineState("electronic-circuit-recycling", { prototype: "recycler", crafting_speed: 0.5, places_results: true });
        expect(state.ingress.outputBlocked()).toBe(false);
        const plate = FactorioDataService.findItemOrThrow("iron-plate").stack_size;
        state.inventoryState.setQuantity("iron-plate", plate);
        expect(state.ingress.outputBlocked()).toBe(true);
        expect(state.ingress.blocked("electronic-circuit")).toBe(true);
    });

    it("answers every ask as a fresh one would, whatever was written and in whatever order it is asked", () => {
        // a fixed pseudo-random walk over writes to all three inventories and asks of every kind
        let seed = 7;
        const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
        for (const build of [eggs, rocketFuel]) {
            const state = build();
            const items = [...state.machine.inputs.keys(), state.machine.fuel_slot!.fuel.item_name, state.machine.output.item_name, "coal"];
            const slots = items.map(item => state.ingress.slotOf(item));
            const inventories = [state.inventoryState, state.fuelInventory, state.selfIngredients];
            for (let step = 0; step < 2000; step++) {
                const roll = next(10);
                if (roll < 3) {
                    const item = items[next(items.length - 1)];
                    inventories[next(3)].setQuantity(item, next(260));
                    continue;
                }
                const reference = fresh(state);
                const index = next(items.length);
                if (roll < 6) {
                    expect(state.ingress.blockedAt(slots[index])).toBe(reference.blocked(items[index]));
                } else if (roll < 8) {
                    expect(state.ingress.blocked(items[index])).toBe(reference.blocked(items[index]));
                } else if (roll < 9) {
                    expect(state.ingress.takesNothing()).toBe(reference.takesNothing());
                } else {
                    expect(state.ingress.outputBlocked()).toBe(reference.outputBlocked());
                }
            }
        }
    });

    it("takes a whole hand from an inserter, of whatever item, with no limit check (a known quirk)", () => {
        const state = rocketFuel();
        expect(state.ingress.accepts("jelly", 1000, DropBy.HAND)).toBe(1000);
        expect(state.ingress.accepts("coal", 5, DropBy.HAND)).toBe(5);
        state.ingress.insert("coal", 5);
        expect(state.inventoryState.getQuantity("coal")).toBe(5);
    });

    it("puts a hand of fuel only in the fuel slot, and one of fuel that is an ingredient there while it is below its limit", () => {
        const only_fuel = rocketFuel();
        only_fuel.fuelInventory.setQuantity("nutrients", 100);
        only_fuel.ingress.insert("nutrients", 4);
        expect(only_fuel.fuelInventory.getQuantity("nutrients")).toBe(104);
        expect(only_fuel.ingress.quantityPutIn("nutrients")).toBe(104);

        const state = eggs();
        state.fuelInventory.addQuantity("nutrients", 8);
        state.ingress.insert("nutrients", 16);
        expect([state.fuelInventory.getQuantity("nutrients"), state.ingress.ingredientQuantity("nutrients")]).toEqual([24, 0]);
        state.ingress.insert("nutrients", 16);
        expect([state.fuelInventory.getQuantity("nutrients"), state.ingress.ingredientQuantity("nutrients")]).toEqual([24, 16]);
        expect(state.ingress.quantityPutIn("nutrients")).toBe(16);
        // an ingredient the recipe also makes goes apart from the output
        state.ingress.insert("pentapod-egg", 1);
        expect(state.selfIngredients.getQuantity("pentapod-egg")).toBe(8);
        expect(state.inventoryState.getQuantity("pentapod-egg")).toBe(0);
    });

    it("takes an ingredient from a placer up to the drill's stop, never as fuel", () => {
        const state = eggs();
        state.ingress.bindPlacerStops();
        const stop = directMachineInsertionLimit(FactorioDataService.findItemOrThrow("nutrients"), state.machine);
        expect(state.ingress.accepts("nutrients", stop + 10, DropBy.PLACER)).toBe(stop);
        state.ingress.place("nutrients", stop - 1);
        expect(state.fuelInventory.getQuantity("nutrients")).toBe(0);
        expect(state.ingress.ingredientQuantity("nutrients")).toBe(stop - 1);
        expect(state.ingress.accepts("nutrients", 3, DropBy.PLACER)).toBe(1);
        expect(state.ingress.accepts("coal", 3, DropBy.PLACER)).toBe(0);
    });

    it("binds a clone's views to the clone's own inventories", () => {
        const state = eggs();
        const cloned = MachineState.clone(state);
        expect(cloned.ingress.blocked("pentapod-egg")).toBe(true);
        cloned.selfIngredients.removeQuantity("pentapod-egg", 1);
        expect(cloned.ingress.blocked("pentapod-egg")).toBe(false);
        expect(state.ingress.blocked("pentapod-egg")).toBe(true);
    });
});
