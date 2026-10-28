import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { RocketSiloChest } from "../../entities";
import { DropBy } from "./ports";
import { WeightStorage } from "./weight-storage";

const silo = (config: Partial<Parameters<typeof RocketSiloChest.fromConfig>[0]> = {}, put_in: string[] = []) =>
    WeightStorage.forChest(RocketSiloChest.fromConfig({ type: "rocket-silo", id: 1, ...config }, put_in));

describe("a rocket silo's Storage (weight), as seen in Factorio 2.1.21 with no rocket built and no craft run", () => {
    it("takes its recipe's ingredients into its input slots, a whole hand while it holds less than the insertion limit", () => {
        const state = silo();
        // rocket part: 3 s at speed 1, overload multiplier 2, limit 2 of each ingredient
        expect(state.chest.input_limits.get("processing-unit")?.quantity).toBe(2);
        expect(state.accepts("processing-unit", 16, DropBy.HAND)).toBe(16);
        state.insert("processing-unit", 16);
        // the game: 16 in the slot, and the inserter brought no more
        expect(state.accepts("processing-unit", 16, DropBy.HAND)).toBe(0);
        expect(state.getAvailableSpace("processing-unit")).toBe(0);
        expect(state.isFull("processing-unit")).toBe(true);
        // the input slots give nothing
        expect(state.getCurrentQuantity("processing-unit")).toBe(0);
        expect(state.has("processing-unit")).toBe(false);
        expect(state.inventoryState.getQuantity("processing-unit")).toBe(16);
    });

    it("raises the insertion limit with its crafting speed", () => {
        // speed 10 (modules, beacons): ceil(1.166 / 0.3) + 1 = 5
        expect(silo({ crafting_speed: 10 }).chest.input_limits.get("rocket-fuel")?.quantity).toBe(5);
    });

    it("takes any other item into its rocket inventory up to the weight the rocket lifts, in part when a hand does not fit", () => {
        const state = silo({}, ["iron-plate"]);
        for (let hand = 0; hand < 62; hand++) state.insert("iron-plate", 16);
        // the game: 992 in, then 8 of the next hand, then the inserter waits holding 8
        expect(state.accepts("iron-plate", 16, DropBy.HAND)).toBe(8);
        expect(state.accepts("iron-plate", 16, DropBy.PLACER)).toBe(8);
        expect(state.getAvailableSpace("iron-plate")).toBe(8);
        state.insert("iron-plate", 8);
        expect(state.isFull("iron-plate")).toBe(true);
        expect(state.isFull()).toBe(true);
        expect(state.getCurrentQuantity("iron-plate")).toBe(1000);
        expect(state.getItemFilters()).toEqual(["iron-plate"]);
    });

    it("puts the ingredients into the rocket inventory when its recipe is of another quality", () => {
        const state = silo({ recipe_quality: "rare" });
        expect(state.chest.toInput("processing-unit")).toBe(false);
        expect(state.getAvailableSpace("processing-unit")).toBe(300);
        state.inventoryState.addQuantity("iron-plate", 50);
        state.inventoryState.addQuantity("processing-unit", 48);
        state.inventoryState.addQuantity("low-density-structure", 48);
        state.inventoryState.addQuantity("rocket-fuel", 55);
        // the game ended at exactly the lift weight with these four
        for (const item of ["iron-plate", "processing-unit", "low-density-structure", "rocket-fuel"]) {
            expect(state.getAvailableSpace(item)).toBe(0);
        }
        expect(state.getCurrentQuantity("rocket-fuel")).toBe(55);
    });

    it("gives the item of its rocket inventory's last slot first, never from its input slots", () => {
        // the game: iron 100, copper 40, gears 20 in the rocket inventory, 10 of each ingredient in the input slots
        const state = silo({ contents: [
            { item: "iron-plate", count: 100 }, { item: "copper-plate", count: 40 }, { item: "iron-gear-wheel", count: 20 },
            { item: "processing-unit", count: 10 }, { item: "low-density-structure", count: 10 }, { item: "rocket-fuel", count: 10 },
        ] });
        expect(state.nextPickupItem(() => true)).toBe("iron-gear-wheel");
        expect(state.nextPickupItem(item => item === "processing-unit")).toBeNull();
        expect(state.getItemFilters()).toEqual(["iron-plate", "copper-plate", "iron-gear-wheel"]);
        state.take("iron-gear-wheel", 20);
        expect(state.nextPickupItem(() => true)).toBe("copper-plate");
        expect(() => state.take("processing-unit", 1)).toThrow();
    });
});
