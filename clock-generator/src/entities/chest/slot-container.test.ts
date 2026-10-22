import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { SlotContainer } from "./slot-container";
import { SlotContainerState } from "../../state/slot-container-state";
import { chestAcceptsItem } from "../../config/inserter-coverage-validator";
import { CargoWagonConfigSchema } from "../../config/schema";
import { BLOCKED_SLOT } from "../../common/slot-filter";

describe("a car, a tank or a cargo wagon from its config", () => {
    it.each(['car', 'tank', 'cargo-wagon'] as const)('keeps blocked slots on a %s, without treating them as cargo', type => {
        const count = type === 'cargo-wagon' ? 40 : 80;
        const slot_filters = Array.from({ length: count - 1 }, (_, i) => ({ slot: i + 2, blocked: true as const }));
        const chest = SlotContainer.fromConfig({ type, id: 1, slot_filters }, ['iron-plate']);
        const state = SlotContainerState.forChest(chest);
        expect(chest.getCapacity('iron-plate')).toBe(100);
        expect(chest.getItemFilters()).toEqual(['iron-plate']);
        expect(state.inventoryState.roomFor('iron-plate')).toBe(100);
        expect(state.inventoryState.capacityFor('iron-plate')).toBe(100);
        state.inventoryState.addQuantity('iron-plate', 100);
        expect(state.isFull('iron-plate')).toBe(true);
        expect(() => state.inventoryState.addQuantity('copper-plate', 1)).toThrow('No room');
        expect(state.inventoryState.slots.slice(1).every(slot => slot.item === null)).toBe(true);
        expect(state.inventoryState.slots[1].filter).toBe(BLOCKED_SLOT);
        expect(state.inventoryState.clone().slots).toEqual(state.inventoryState.slots);
    });

    it('takes no item into a blocked slot, and keeps blocked slots out of available capacity', () => {
        const config = { type: 'cargo-wagon' as const, id: 1,
            slot_filters: Array.from({ length: 40 }, (_, i) => ({ slot: i + 1, blocked: true as const })) };
        const chest = SlotContainer.fromConfig(config);
        expect(chest.getCapacity()).toBe(0);
        expect(chest.getCapacity('iron-plate')).toBe(0);
        expect(chest.getItemFilters()).toEqual([]);
        expect(chest.acceptsItem('iron-plate')).toBe(false);
        expect(chestAcceptsItem(config, 'iron-plate')).toBe(false);
        expect(chestAcceptsItem({ ...config, slot_filters: config.slot_filters.slice(1) }, 'iron-plate')).toBe(true);
        expect(() => SlotContainer.fromConfig({ type: 'car', id: 1, slot_filters: [{ slot: 1, blocked: true }], contents: [{ slot: 1, item: 'iron-plate', count: 1 }] }))
            .toThrow('slot 1 is blocked and cannot hold iron-plate');
        expect(() => SlotContainer.fromConfig({ type: 'car', id: 1, slot_filters: [{ slot: 1, blocked: true }, { slot: 1, item: 'iron-plate' }] }))
            .toThrow('slot 1 is filtered twice');
    });

    it.each(['no-item', 'deconstruction-planner'])('reads a slot filtered to %s, as a config of the 0.20.0 drafts names it, as blocked', marker => {
        const config = CargoWagonConfigSchema.parse({ type: 'cargo-wagon', id: 1,
            slot_filters: Array.from({ length: 39 }, (_, i) => ({ slot: i + 2, item: marker })) });
        expect(config.slot_filters?.every(filter => filter.blocked === true && filter.item === undefined)).toBe(true);
        const chest = SlotContainer.fromConfig(config, ['iron-plate']);
        expect(chest.getCapacity('iron-plate')).toBe(100);
        expect(chest.getItemFilters()).toEqual(['iron-plate']);
    });

    it('still refuses unknown item names in slot filters', () => {
        expect(() => SlotContainer.fromConfig({ type: 'car', id: 1, slot_filters: [{ slot: 1, item: 'unknown-blocker' }] })).toThrow();
    });

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
