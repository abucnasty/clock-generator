import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { SlotContainer } from "./slot-container";

describe("a car, a tank or a cargo wagon from its config", () => {
    it("has the slots of the game data, a wagon's by its quality, with its slot filters", () => {
        expect(SlotContainer.fromConfig({ type: "car", id: 1 }).slot_count).toBe(80);
        expect(SlotContainer.fromConfig({ type: "tank", id: 1 }).slot_count).toBe(80);
        expect(SlotContainer.fromConfig({ type: "cargo-wagon", id: 1 }).slot_count).toBe(40);
        const wagon = SlotContainer.fromConfig({ type: "cargo-wagon", id: 1, quality: "legendary", slot_filters: [{ slot: 100, item: "coal" }] });
        expect(wagon.slot_count).toBe(100);
        expect(wagon.slot_filters[99]).toBe("coal");
        expect(wagon.acceptsItem("coal")).toBe(true);
        expect(wagon.getItemFilters()).toEqual(["coal"]);
    });

    it("refuses slot filters and contents it cannot hold", () => {
        expect(() => SlotContainer.fromConfig({ type: "cargo-wagon", id: 3, slot_filters: [{ slot: 41, item: "coal" }] }))
            .toThrow("Chest 3 (cargo-wagon): slot filter 41 is past its 40 slots");
        expect(() => SlotContainer.fromConfig({ type: "car", id: 3, contents: [{ slot: 1, item: "coal", count: 51 }] }))
            .toThrow("Chest 3 (car): 51 coal in slot 1, more than a stack of 50");
        expect(() => SlotContainer.fromConfig({ type: "car", id: 3, slot_filters: [{ slot: 2, item: "coal" }],
            contents: [{ slot: 2, item: "wood", count: 1 }] })).toThrow("Chest 3 (car): slot 2 is filtered to coal and cannot hold wood");
        expect(() => SlotContainer.fromConfig({ type: "car", id: 3, slot_filters: [{ slot: 2, item: "coal" }, { slot: 2, item: "wood" }] }))
            .toThrow("Chest 3 (car): slot 2 is filtered twice");
    });
});
