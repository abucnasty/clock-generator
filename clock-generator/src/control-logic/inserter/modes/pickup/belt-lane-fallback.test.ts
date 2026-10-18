import { GameFixturePaths } from "../../../../../tests/game/helpers/fixture-paths";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { Config } from "../../../../config";
import { loadConfigFromFile } from "../../../../config/loader";
import { SimulationContext } from "../../../../crafting/sequence/simulation-context";
import { EntityState } from "../../../../state";
import { InserterPickupMode } from "./pickup-mode";

let sample: Config;
beforeAll(async () => { sample = await loadConfigFromFile(GameFixturePaths.SAME_ITEM_CONFIG); });

function pickup(config: Config) {
    const context = SimulationContext.fromConfig(config);
    const state = context.inserters.find(inserter => inserter.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected a belt source");
    const mode = InserterPickupMode.create({
        inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
        tick_provider: context.tick_provider,
    });
    return { state, source, lanes: source.pickup_lanes.get(state.entity_id.id)!, take(tick: number) {
        context.tick_provider.setCurrentTick(tick);
        const before = state.held_item?.quantity ?? 0;
        mode.executeForTick();
        return (state.held_item?.quantity ?? 0) - before;
    } };
}
const copy = () => structuredClone(sample);

describe("physical belt lane fallback", () => {
    it.each([0, 1])("front underground entrance with the same item on both moving lanes: phase start=%i", async start => {
        const config = await loadConfigFromFile(GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE_SAME_ITEM_CONFIG);
        const input = pickup(config);
        expect([0, 1, 2, 3].map(tick => input.take(tick + start))).toEqual([4, 4, 4, 4]);
        expect(input.state.held_item).toEqual({ item_name: "accumulator", quantity: 16 });
        expect(input.lanes[1].stateKey(start + 3)).toContain(":0");

        // Changing just lane 2 back to another item prevents it from finishing the accumulator hand.
        config.belts.find(belt => belt.id === 2)!.lanes[1]!.ingredient = "supercapacitor";
        const mixed = pickup(config);
        [0, 1, 2, 3].forEach(tick => mixed.take(tick + start));
        expect(mixed.state.held_item).toEqual({ item_name: "accumulator", quantity: 12 });
    });

    for (const { mirrored, preferred, item } of [
        { mirrored: false, preferred: 1, item: "accumulator" },
        { mirrored: true, preferred: 2, item: "supercapacitor" },
    ] as const) it.each([
        { backedUp: false, start: 0, ticks: [0, 1, 3, 5] },
        { backedUp: false, start: 1, ticks: [0, 1, 2, 4] },
        { backedUp: true, start: 0, ticks: [0, 1, 2, 3] },
    ])(`front underground entrance: mirrored=${mirrored}, lane ${preferred}, backedUp=$backedUp, phase start=$start`, async ({ backedUp, start, ticks }) => {
        const config = await loadConfigFromFile(path.join(GameFixturePaths.FRONT_UNDERGROUND_ENTRANCE, "config.json"));
        config.overrides = { ...config.overrides, backed_up_belts: backedUp };
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        source.near_lane = preferred;
        const input = pickup(config);
        const observed: number[] = [];
        for (let tick = 0; tick <= ticks[ticks.length - 1]; tick++) {
            if (input.take(tick + start)) observed.push(tick);
        }
        expect(observed).toEqual(ticks);
        expect(input.state.held_item).toEqual({ item_name: item, quantity: 16 });
        // Recipe order stays fixed across both mirroring states; it disagrees with the unmirrored lane 1.
        delete source.near_lane;
        const recipeOrdered = pickup(config);
        recipeOrdered.take(start);
        expect(recipeOrdered.state.held_item).toEqual({ item_name: "supercapacitor", quantity: 4 });
    });

    it.each([
        { label: "original lanes", swapped: false, preferred: 2, item: "supercapacitor" },
        { label: "swapped lanes", swapped: true, preferred: 2, item: "accumulator" },
        { label: "flipped inserter, swapped lanes", swapped: true, preferred: 1, item: "supercapacitor" },
    ] as const)("matches the front underground exit's measured first hand: $label", async ({ swapped, preferred, item }) => {
        const config = await loadConfigFromFile(path.join(GameFixturePaths.FRONT_UNDERGROUND_EXIT, "config.json"));
        if (swapped) config.belts.find(belt => belt.id === 2)!.lanes.reverse();
        const source = config.inserters[1].source;
        if (source.type !== "belt") throw new Error("expected belt input");
        source.near_lane = preferred;
        const input = pickup(config);
        // Factorio 2.1.21: mirrored selects lane 2; flipping with swapped ingredients selects lane 1.
        expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 4, 4]);
        expect(input.state.held_item).toEqual({ item_name: item, quantity: 16 });

        // The same recipe order selects supercapacitors in all cases if lane preference is omitted.
        delete source.near_lane;
        const recipeOrdered = pickup(config);
        recipeOrdered.take(0);
        expect(recipeOrdered.state.held_item).toEqual({ item_name: "supercapacitor", quantity: 4 });
    });

    for (const near of [1, 2] as const) for (const type of ["turbo-transport-belt", "express-transport-belt"] as const) {
        it(`fills an underground hand in four consecutive grabs: ${type}, near lane ${near}`, () => {
            const config = copy();
            config.belts[0].type = type;
            config.inserters[1].source = { type: "belt", id: 1, near_lane: near, pickup_length: 0.5 };
            const input = pickup(config);
            expect(input.state.inserter.near_lane).toBe(near);
            expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 4, 4]);
            expect(input.state.held_item?.quantity).toBe(16);
            // The other lane supplied a grab: its holes are part of the persistent pickup state too.
            expect(input.lanes[2 - near].stateKey(3)).toContain(":0");
        });
    }

    it("uses the preferred lane's stack size, then caps a fallback grab at the remaining hand capacity", () => {
        const config = copy();
        config.belts[0].lanes[1]!.stack_size = 2;
        config.inserters[1].source = { type: "belt", id: 1, near_lane: 2, pickup_length: 0.5 };
        config.inserters[1].stack_size = 7;
        const input = pickup(config);
        expect([0, 1, 2].map(input.take)).toEqual([2, 2, 3]);
        expect(input.state.held_item).toEqual({ item_name: "iron-plate", quantity: 7 });
    });

    it("does not take a different item from the far lane while filling the current hand", () => {
        const config = copy();
        config.belts[0].lanes[1]!.ingredient = "copper-plate";
        const input = pickup(config);
        expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 0, 4]);
        expect(input.state.held_item?.item_name).toBe("iron-plate");
    });

    it("retains the first-lane convention when the nearest physical lane was not supplied", () => {
        const config = copy();
        config.inserters[1].source = { type: "belt", id: 1, pickup_length: 0.5 };
        config.belts[0].lanes[0].stack_size = 2;
        expect(pickup(config).take(0)).toBe(2);
    });

    it("does not use fallback for a second grab in the same tick", () => {
        const input = pickup(copy());
        expect(input.take(0)).toBe(4);
        expect(input.take(0)).toBe(0);
        expect(input.take(1)).toBe(4);
    });

    it("defaults omitted geometry to a moving straight-belt pickup", () => {
        const config = copy();
        config.inserters[1].source = { type: "belt", id: 1, near_lane: 1 };
        const input = pickup(config);
        expect(input.state.inserter.pickup_length).toBe(1);
        expect(input.state.inserter.belt_supply).toBe("moving");
        expect(input.source.pickup_lanes.size).toBe(1);
        expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 4, 4]);
    });

    it("retains geometry while explicitly backed-up supply allows consecutive grabs", () => {
        for (const length of [1, 0.5] as const) {
            const config = copy();
            config.overrides = { backed_up_belts: true };
            config.inserters[1].source = { type: "belt", id: 1, near_lane: 1, pickup_length: length };
            const input = pickup(config);
            expect(input.state.inserter.pickup_length).toBe(length);
            expect(input.state.inserter.belt_supply).toBe("backed_up");
            expect(input.source.pickup_lanes.size).toBe(0);
            expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 4, 4]);
        }
    });
});
