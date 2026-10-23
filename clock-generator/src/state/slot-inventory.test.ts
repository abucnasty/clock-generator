import { describe, expect, it } from "vitest";
import "../data/factorio-data-file";
import { SlotInventoryState, weightUnits } from "./slot-inventory";

/** A short trunk: slot 1 filtered to copper, slot 4 to copper, the others free */
const trunk = () => new SlotInventoryState({ slot_filters: ["copper-plate", null, null, "copper-plate", null, null] });
const slots = (inventory: SlotInventoryState) => inventory.slots.map(slot => slot.item === null ? "-" : `${slot.item}:${slot.count}`);

describe("a slot inventory, as seen in Factorio 2.1.21 on a car", () => {
    it("puts an item into its filtered slots first, in slot order, then tops up its free slots that hold it, then fills empty ones", () => {
        // the game's car: filtered slots 1, 4 and 80 took copper before free slot 3 (a partial stack) and free slot 2
        const inventory = trunk();
        inventory.placeInSlot(2, "copper-plate", 50);
        inventory.placeInSlot(3, "copper-plate", 30);
        inventory.placeInSlot(4, "wood", 100);
        inventory.addQuantity("copper-plate", 100);
        expect(slots(inventory)).toEqual(["copper-plate:100", "-", "copper-plate:50", "copper-plate:30", "wood:100", "-"]);
        inventory.addQuantity("copper-plate", 120);
        expect(slots(inventory)).toEqual(["copper-plate:100", "-", "copper-plate:100", "copper-plate:100", "wood:100", "-"]);
        inventory.addQuantity("copper-plate", 150);
        expect(slots(inventory)).toEqual(["copper-plate:100", "copper-plate:100", "copper-plate:100", "copper-plate:100", "wood:100", "copper-plate:50"]);
        expect(inventory.getQuantity("copper-plate")).toBe(450);
    });

    it("keeps a slot filtered to another item out of the room for an item", () => {
        const inventory = trunk();
        expect(inventory.roomFor("iron-plate")).toBe(400);
        expect(inventory.roomFor("copper-plate")).toBe(600);
        expect(inventory.capacityFor("iron-plate")).toBe(400);
        expect(() => inventory.addQuantity("iron-plate", 401)).toThrow("No room for 401 iron-plate: 400 fit");
    });

    it("has room for one item only in what the other items leave of its free slots", () => {
        const inventory = trunk();
        inventory.addQuantity("iron-plate", 250);
        inventory.addQuantity("coal", 50);
        // iron in slots 2, 3 and half of 5, coal in 6: copper has its two filtered slots and nothing free
        expect(slots(inventory)).toEqual(["-", "iron-plate:100", "iron-plate:100", "-", "iron-plate:50", "coal:50"]);
        expect(inventory.roomFor("copper-plate")).toBe(200);
        expect(inventory.roomFor("iron-plate")).toBe(50);
        expect(inventory.roomFor("coal")).toBe(0);
    });

    it("gives an inserter the item of its last slot first, from that slot and then the ones before it", () => {
        // the game's car: iron 40 in slot 1, copper 100 in 2, gears 30 in 5, iron 100 in 9: an unfiltered inserter took
        // iron from slot 9, then 4 of it and 12 from slot 1, then the gears
        const inventory = new SlotInventoryState({ slot_filters: new Array(10).fill(null) });
        inventory.placeInSlot(0, "iron-plate", 40);
        inventory.placeInSlot(1, "copper-plate", 100);
        inventory.placeInSlot(4, "iron-gear-wheel", 30);
        inventory.placeInSlot(8, "iron-plate", 100);
        const any = () => true;
        expect(inventory.lastItemAmong(any)).toBe("iron-plate");
        for (let hand = 0; hand < 6; hand++) inventory.removeQuantity("iron-plate", 16);
        expect(slots(inventory)[8]).toBe("iron-plate:4");
        inventory.removeQuantity("iron-plate", 16);
        expect(slots(inventory)[0]).toBe("iron-plate:28");
        expect(slots(inventory)[8]).toBe("-");
        expect(inventory.lastItemAmong(any)).toBe("iron-gear-wheel");
        // an inserter filtered to iron passes the gears and the copper by
        expect(inventory.lastItemAmong(item => item === "iron-plate")).toBe("iron-plate");
        expect(inventory.lastItemAmong(item => item === "steel-plate")).toBeNull();
    });

    it("stops at its weight limit, slot after slot as items come, for a rocket's inventory", () => {
        // the game's silo with no rocket built: 1,000 iron plates of 1,000,000, 300 processing units
        const rocket = () => new SlotInventoryState({ weight_limit: weightUnits(1_000_000) });
        expect(rocket().roomFor("iron-plate")).toBe(1000);
        expect(rocket().roomFor("processing-unit")).toBe(300);
        expect(rocket().roomFor("low-density-structure")).toBe(200);
        expect(rocket().roomFor("rocket-fuel")).toBe(100);
        const inventory = rocket();
        inventory.addQuantity("iron-plate", 480);
        expect(inventory.slots.length).toBe(5);
        // the rare rocket part build: 50 iron, 48 processing units, 48 structures and 55 rocket fuel fill it exactly
        const mixed = rocket();
        mixed.addQuantity("iron-plate", 50);
        mixed.addQuantity("processing-unit", 48);
        mixed.addQuantity("low-density-structure", 48);
        mixed.addQuantity("rocket-fuel", 55);
        for (const item of ["iron-plate", "processing-unit", "low-density-structure", "rocket-fuel"]) {
            expect(mixed.roomFor(item)).toBe(0);
        }
        mixed.removeQuantity("rocket-fuel", 1);
        expect(mixed.roomFor("iron-plate")).toBe(10);
    });

    it("clones its slots, its totals and its weight", () => {
        const inventory = new SlotInventoryState({ weight_limit: weightUnits(1_000_000) });
        inventory.addQuantity("iron-plate", 900);
        const copy = inventory.clone();
        copy.addQuantity("iron-plate", 100);
        expect(inventory.getQuantity("iron-plate")).toBe(900);
        expect(copy.roomFor("iron-plate")).toBe(0);
        expect(inventory.roomFor("iron-plate")).toBe(100);
    });
});
