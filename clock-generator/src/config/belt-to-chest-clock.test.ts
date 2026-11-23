import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { generateClockAlternatives } from "../crafting/generate-blueprint";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

/** A full, standing lane of iron plates in stacks of 4, ending at a dead end */
const LANE = { ingredient: "iron-plate", stack_size: 4, lane_end: { kind: "dead_end" } };

/**
 * Electronic circuits from an assembling machine 3 whose iron plates come from a belt through a steel chest of 48 slots:
 * one legendary stack inserter takes from the belt into the chest, another from the chest into the machine. The copper
 * cable comes from an infinity chest by a hand of 6, and the circuits go out into an infinity chest that takes them.
 */
const beltThroughChest = () => ConfigSchema.parse({
    setpoint: { item: "electronic-circuit", items_per_second: 2, copies: 1 },
    machines: [{ id: 1, recipe: "electronic-circuit", prototype: "assembling-machine-3", crafting_speed: 1.25, productivity: 0 }],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [LANE, LANE] }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1, near_lane: 1, pickup_length: 1, pickup_layout: "side-straight" },
            sink: { type: "chest", id: 1 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16, filters: ["iron-plate"] },
        { id: 2, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16 },
        { id: 3, source: { type: "chest", id: 2 }, sink: { type: "machine", id: 1 }, prototype: "stack-inserter", quality: "legendary",
            stack_size: 6, filters: ["copper-cable"] },
        { id: 4, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 3 }, prototype: "stack-inserter", quality: "legendary",
            stack_size: 16, filters: ["electronic-circuit"] },
    ],
    chests: [
        { id: 1, type: "buffer-chest", storage_size: 48, item_filter: "iron-plate", prototype: "steel-chest" },
        { id: 2, type: "infinity-chest", item_filter: [{ item_name: "copper-cable", request_count: 192 }] },
        { id: 3, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true },
    ],
});

describe("a belt that feeds a machine through a steel chest of 48 slots", () => {
    it("clocks: the selected clock is stable", () => {
        const result = generateClockAlternatives(beltThroughChest(), { logger: quiet });
        expect(result.alternatives[result.selected_index].verdict).toBe("stable");
        expect(result.why_not_stable).toBeNull();
    });
});
