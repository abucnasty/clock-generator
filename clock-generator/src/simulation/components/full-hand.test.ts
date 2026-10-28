import { describe, expect, it } from "vitest";
import { ConfigSchema, type Config } from "../../config/schema";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { TickByHand } from "../../crafting/runner/tick-by-hand.fixture";
import { EntityState } from "../../state";

/**
 * Whether an inserter waits for a full hand is its prototype's own `wait_for_full_hand` (the stack inserter only in the
 * game data), at any source. Recorded at an assembling machine 3's output (2.1.21): the bulk and the fast inserter swung
 * each craft's 2 cables on their own, the stack inserter waited.
 */
const GEARS = "iron-gear-wheel";

/** Gears from an assembling machine at crafting speed 1 (a gear a second), taken into a car by an inserter of the prototype */
function gearsTakenBy(prototype: string, quality = "normal"): Config {
    return ConfigSchema.parse({
        target_output: { recipe: GEARS, items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: GEARS, productivity: 0, crafting_speed: 1 }],
        inserters: [
            { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, filters: ["iron-plate"] },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 2 }, prototype, quality, filters: [GEARS] },
        ],
        belts: [],
        chests: [{ type: "infinity-chest", id: 1, item_filter: [{ item_name: "iron-plate", request_count: 100 }] }, { type: "car", id: 2 }],
    }) as Config;
}

/** The hands the inserter drops in two minutes, by their size */
function handsDropped(config: Config): Map<number, number> {
    const context = SimulationContext.fromConfig(config);
    const tick = new TickByHand(context);
    const state = context.state_registry.getAllStates().filter(EntityState.isInserter).find(it => it.entity_id.id === "inserter:2")!;
    const hands = new Map<number, number>();
    for (let i = 0; i < 120 * 60; i++) {
        const before = state.items_dropped;
        tick.executeForTick();
        const dropped = state.items_dropped - before;
        if (dropped > 0) hands.set(dropped, (hands.get(dropped) ?? 0) + 1);
    }
    return hands;
}

describe("an inserter at a machine's output", () => {
    it.each(["fast-inserter", "bulk-inserter", "inserter"])("swings what the %s holds, a gear or a few as they come", prototype => {
        const hands = handsDropped(gearsTakenBy(prototype));
        // a gear a second: never the hand of 4 or 12 it would wait for
        expect(Math.max(...hands.keys())).toBeLessThan(4);
        // every gear of the two minutes, less the first craft and the swing in progress, is carried
        expect([...hands].reduce((sum, [size, count]) => sum + size * count, 0)).toBeGreaterThan(110);
    });

    it("waits for a full hand of 16 with the stack inserter", () => {
        const hands = handsDropped(gearsTakenBy("stack-inserter", "legendary"));
        expect([...hands.keys()]).toEqual([16]);
        expect(hands.get(16)).toBeGreaterThanOrEqual(7);
    });
});
