import path from "path";
import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "./loader";
import { ChestConfigSchema } from "./schema";
import { migrateBlockedSlotFilter } from "./migrate-blocked-slots";

describe("a blocked slot in the config", () => {
    it("is read from a filter named no-item or deconstruction-planner, and other filters stay as they are", () => {
        const car = ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [
            { slot: 1, item: "iron-plate" }, { slot: 2, item: "no-item" }, { slot: 3, item: "deconstruction-planner" }, { slot: 4, blocked: true }] });
        expect(car).toMatchObject({ slot_filters: [{ slot: 1, item: "iron-plate" }, { slot: 2, blocked: true }, { slot: 3, blocked: true }, { slot: 4, blocked: true }] });
        expect((car as { slot_filters: object[] }).slot_filters.slice(1).every(filter => !("item" in filter))).toBe(true);
    });

    it("is read from the legacy fixture: a wagon's No item and Deconstruction planner slots", async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "fixtures/legacy/blocked-slot-item.json"));
        expect(config.chests).toMatchObject([{ slot_filters: [{ slot: 1, item: "iron-ore" }, { slot: 2, blocked: true }, { slot: 3, blocked: true }] }]);
    });

    it("leaves anything that is not a slot filter of the former spelling untouched", () => {
        for (const value of [null, 3, "no-item", ["no-item"], { slot: 1, item: "coal" }, { slot: 1, item: "no-item", blocked: true }]) {
            expect(migrateBlockedSlotFilter(value)).toBe(value);
        }
    });

    it("is refused with an item as well, or as blocked: false", () => {
        expect(() => ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [{ slot: 1, item: "coal", blocked: true }] })).toThrow();
        expect(() => ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [{ slot: 1, blocked: false }] })).toThrow();
        expect(() => ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [{ slot: 1 }] })).toThrow();
    });
});
