import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { Chest } from "../../entities";
import { ConstantStorage } from "./constant-storage";
import { ContainerStorage } from "./container-storage";
import { HeldStorage } from "./held-storage";
import { DropBy } from "./ports";
import { SingleItemStorage } from "./single-item-storage";
import { SlotStorage } from "./slot-storage";
import { WeightStorage } from "./weight-storage";

describe("the Storage of a container, by its class", () => {
    const buffer = ContainerStorage.forChest(Chest.fromConfig({ type: "buffer-chest", id: 1, storage_size: 1, item_filter: "iron-plate" }));
    const infinity = ContainerStorage.forChest(Chest.fromConfig({ type: "infinity-chest", id: 2, item_filter: [{ item_name: "coal", request_count: 50 }] }));
    const car = ContainerStorage.forChest(Chest.fromConfig({ type: "car", id: 3 }, ["iron-plate"]));
    const silo = ContainerStorage.forChest(Chest.fromConfig({ type: "rocket-silo", id: 4 }, ["iron-plate"]));

    it("is one variant for each kind of container, which the archetype guards tell apart", () => {
        expect(buffer).toBeInstanceOf(SingleItemStorage);
        expect(infinity).toBeInstanceOf(ConstantStorage);
        expect(car).toBeInstanceOf(SlotStorage);
        expect(silo).toBeInstanceOf(WeightStorage);
        expect([buffer, infinity, car, silo].map(ContainerStorage.is)).toEqual([true, true, true, true]);
        expect([buffer, infinity, car, silo].map(ContainerStorage.isMixed)).toEqual([false, false, true, true]);
        expect([buffer, infinity, car, silo].map(ContainerStorage.isFinite)).toEqual([true, false, true, true]);
    });

    it("accepts from a hand or a placer as much of what is held as it has room for, and nothing once full", () => {
        // a buffer chest of one slot of iron plates: 100
        expect(buffer.accepts("iron-plate", 12, DropBy.HAND)).toBe(12);
        buffer.insert("iron-plate", 95);
        expect(buffer.accepts("iron-plate", 12, DropBy.HAND)).toBe(5);
        expect(buffer.accepts("iron-plate", 12, DropBy.PLACER)).toBe(5);
        buffer.insert("iron-plate", 5);
        expect(buffer.accepts("iron-plate", 12, DropBy.HAND)).toBe(0);
        expect(buffer.isFull()).toBe(true);
    });

    it("gives what it holds through its pickup port", () => {
        expect(car.has("iron-plate")).toBe(false);
        car.insert("iron-plate", 3);
        expect(car.has("iron-plate")).toBe(true);
        car.take("iron-plate", 3);
        expect(car.getCurrentQuantity("iron-plate")).toBe(0);
        expect(car.has("iron-plate")).toBe(false);
    });

    it("takes anything and gives without end when constant, but for an item its supply gate withholds or refuses", () => {
        expect(infinity.accepts("coal", 1000, DropBy.PLACER)).toBe(1000);
        infinity.take("coal", 50);
        expect(infinity.getCurrentQuantity("coal")).toBe(50);
        infinity.supply.withheld.add("coal");
        expect(infinity.has("coal")).toBe(false);
        infinity.supply.withheld.delete("coal");
        infinity.supply.refused.add("coal");
        expect(infinity.accepts("coal", 1, DropBy.HAND)).toBe(0);
        infinity.supply.refused.delete("coal");
    });
});

describe("the Storage of what a drill holds", () => {
    it("keeps its item's slot, takes what the bars complete and gives it to the drop", () => {
        const held = HeldStorage.forItem("iron-ore");
        expect(held.getCurrentQuantity("iron-ore")).toBe(0);
        held.insert("iron-ore", 2);
        expect(held.has("iron-ore")).toBe(true);
        held.take("iron-ore", 2);
        expect(held.getCurrentQuantity("iron-ore")).toBe(0);
        expect(held.inventoryState.getItem("iron-ore")).not.toBeNull();
    });
});
